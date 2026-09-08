import fs from 'fs';
import path from 'path';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
  PutBucketPolicyCommand,
} from '@aws-sdk/client-s3';
import {
  IStorageService,
  StorageUploadOptions,
  StorageUploadResult,
} from '../../core/interfaces/IStorageService.js';
import { Logger } from '../../utils/logger.js';

export interface S3StorageConfig {
  bucket: string;
  region?: string;
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  forcePathStyle?: boolean;
  publicUrl?: string;
}

export class S3StorageService implements IStorageService {
  public readonly driverName = 's3';
  private readonly client: S3Client;
  private readonly config: S3StorageConfig;
  private bucketEnsured = false;
  private ensuringPromise: Promise<void> | null = null;

  constructor(config: S3StorageConfig) {
    let normalizedEndpoint = config.endpoint ? config.endpoint.trim() : undefined;
    if (normalizedEndpoint) {
      // Ensure HTTP/HTTPS protocol is present
      if (!/^https?:\/\//i.test(normalizedEndpoint)) {
        if (/:9000|:9001|:5000|localhost|127\.0\.0\.1/i.test(normalizedEndpoint)) {
          normalizedEndpoint = `http://${normalizedEndpoint}`;
        } else {
          normalizedEndpoint = `https://${normalizedEndpoint}`;
        }
      }
      // Strip trailing slashes
      normalizedEndpoint = normalizedEndpoint.replace(/\/+$/, '');

      // Check hostname for underscores (common cause of MinIO "Invalid Request (invalid hostname)" error)
      try {
        const u = new URL(normalizedEndpoint);
        if (u.hostname.includes('_')) {
          Logger.warn(
            'Storage:S3',
            `Endpoint hostname "${u.hostname}" contains an underscore ("_"). ` +
            `MinIO enforces RFC 1123 DNS standards. Automatically applying Host-header sanitizer middleware.`
          );
        }
      } catch (err: any) {
        Logger.warn('Storage:S3', `Could not parse endpoint URL "${normalizedEndpoint}": ${err.message}`);
      }
    }

    const normalizedBucket = (config.bucket || 'combusticket').trim().toLowerCase();

    // For MinIO or any custom endpoint, forcePathStyle MUST be true unless explicitly disabled
    const isCustomEndpoint = Boolean(normalizedEndpoint);
    const forcePathStyle =
      config.forcePathStyle !== undefined
        ? config.forcePathStyle
        : isCustomEndpoint;

    this.config = {
      ...config,
      bucket: normalizedBucket,
      endpoint: normalizedEndpoint,
      forcePathStyle,
    };

    this.client = new S3Client({
      region: config.region || 'us-east-1',
      endpoint: normalizedEndpoint || undefined,
      forcePathStyle,
      credentials:
        config.accessKeyId && config.secretAccessKey
          ? {
              accessKeyId: config.accessKeyId,
              secretAccessKey: config.secretAccessKey,
            }
          : undefined,
    });

    // MinIO & Go HTTP servers strictly enforce RFC 1123, rejecting hostnames with underscores '_' (e.g. "chambapro_minio").
    // We attach an SDK middleware to sanitize the outgoing HTTP 'host' header to replace '_' with '-' before SigV4 signing.
    this.client.middlewareStack.add(
      (next) => async (args) => {
        const req: any = args.request;
        if (req?.headers?.host && req.headers.host.includes('_')) {
          req.headers.host = req.headers.host.replace(/_/g, '-');
        }
        return next(args);
      },
      {
        step: 'build',
        name: 'sanitizeMinioHostHeader',
        priority: 'low',
      }
    );
  }

  private sanitizeKey(key: string): string {
    return key
      .replace(/\\/g, '/')
      .replace(/^(\.\.[\/\\])+/, '')
      .replace(/^\/+/, '')
      .replace(/^output\//, '');
  }

  private detectContentType(keyOrPath: string): string {
    const ext = path.extname(keyOrPath).toLowerCase();
    switch (ext) {
      case '.png':
        return 'image/png';
      case '.jpg':
      case '.jpeg':
        return 'image/jpeg';
      case '.webp':
        return 'image/webp';
      case '.webm':
        return 'video/webm';
      case '.mp4':
        return 'video/mp4';
      case '.pdf':
        return 'application/pdf';
      case '.xml':
        return 'application/xml';
      case '.json':
        return 'application/json';
      default:
        return 'application/octet-stream';
    }
  }

  public getUrl(key: string): string {
    const cleanKey = this.sanitizeKey(key);

    if (this.config.publicUrl) {
      const baseUrl = this.config.publicUrl.replace(/\/+$/, '');
      return `${baseUrl}/${cleanKey}`;
    }

    if (this.config.endpoint) {
      const endpoint = this.config.endpoint.replace(/\/+$/, '');
      const forcePathStyle =
        this.config.forcePathStyle !== undefined
          ? this.config.forcePathStyle
          : true;

      if (forcePathStyle) {
        return `${endpoint}/${this.config.bucket}/${cleanKey}`;
      } else {
        const urlObj = new URL(endpoint);
        return `${urlObj.protocol}//${this.config.bucket}.${urlObj.host}/${cleanKey}`;
      }
    }

    const region = this.config.region || 'us-east-1';
    return `https://${this.config.bucket}.s3.${region}.amazonaws.com/${cleanKey}`;
  }

  public async init(): Promise<void> {
    return this.ensureBucket();
  }

  public async ensureBucket(): Promise<void> {
    if (this.bucketEnsured) return;
    if (this.ensuringPromise) return this.ensuringPromise;

    this.ensuringPromise = (async () => {
      const bucket = this.config.bucket;
      const isCustomEndpoint = Boolean(this.config.endpoint);

      try {
        Logger.debug('Storage:S3', `Checking if bucket "${bucket}" exists in MinIO/S3...`);
        await this.client.send(new HeadBucketCommand({ Bucket: bucket }));
        this.bucketEnsured = true;
        Logger.info('Storage:S3', `🟢 Bucket "${bucket}" is ready and accessible.`);
      } catch (err: any) {
        const statusCode = err.$metadata?.httpStatusCode;
        const errName = err.name || '';
        const errMsg = err.message || '';

        if (
          statusCode === 404 ||
          errName === 'NotFound' ||
          errName === 'NoSuchBucket' ||
          errMsg.includes('Not Found') ||
          errMsg.includes('NoSuchBucket')
        ) {
          Logger.info('Storage:S3', `Bucket "${bucket}" does not exist. Auto-creating bucket in MinIO/S3...`);
          try {
            const createParams: any = { Bucket: bucket };
            if (this.config.region && this.config.region !== 'us-east-1' && !isCustomEndpoint) {
              createParams.CreateBucketConfiguration = {
                LocationConstraint: this.config.region,
              };
            }
            await this.client.send(new CreateBucketCommand(createParams));
            this.bucketEnsured = true;
            Logger.info('Storage:S3', `✅ Bucket "${bucket}" created successfully in MinIO/S3.`);

            // Configure bucket policy for public read (essential for MinIO so downloaded PDFs/images are directly viewable)
            await this.applyPublicReadPolicy(bucket);
          } catch (createErr: any) {
            if (createErr.name === 'BucketAlreadyOwnedByYou' || createErr.name === 'BucketAlreadyExists') {
              this.bucketEnsured = true;
            } else {
              Logger.error('Storage:S3', `Failed to create bucket "${bucket}": ${createErr.message}`);
              throw createErr;
            }
          }
        } else if (statusCode === 403 || errName === 'AccessDenied') {
          Logger.error(
            'Storage:S3',
            `❌ AccessDenied (403) for bucket "${bucket}". Verify S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY credentials.`
          );
          throw err;
        } else {
          Logger.warn('Storage:S3', `Bucket check warning (${errName || statusCode}): ${errMsg}. Attempting CreateBucket...`);
          try {
            await this.client.send(new CreateBucketCommand({ Bucket: bucket }));
            this.bucketEnsured = true;
            Logger.info('Storage:S3', `✅ Bucket "${bucket}" created successfully.`);
            await this.applyPublicReadPolicy(bucket);
          } catch (createErr: any) {
            if (createErr.name === 'BucketAlreadyOwnedByYou' || createErr.name === 'BucketAlreadyExists') {
              this.bucketEnsured = true;
            } else {
              Logger.error('Storage:S3', `Could not create bucket "${bucket}": ${createErr.message}`);
              throw createErr;
            }
          }
        }
      } finally {
        this.ensuringPromise = null;
      }
    })();

    return this.ensuringPromise;
  }

  private async applyPublicReadPolicy(bucket: string): Promise<void> {
    try {
      const publicPolicy = JSON.stringify({
        Version: '2012-10-17',
        Statement: [
          {
            Sid: 'PublicReadGetObject',
            Effect: 'Allow',
            Principal: '*',
            Action: ['s3:GetObject'],
            Resource: [`arn:aws:s3:::${bucket}/*`],
          },
        ],
      });

      await this.client.send(
        new PutBucketPolicyCommand({
          Bucket: bucket,
          Policy: publicPolicy,
        })
      );
      Logger.debug('Storage:S3', `Applied public read policy to bucket "${bucket}".`);
    } catch (policyErr: any) {
      Logger.debug('Storage:S3', `Bucket policy notice: ${policyErr.message}`);
    }
  }

  public async upload(
    key: string,
    data: Buffer | Uint8Array,
    options?: StorageUploadOptions
  ): Promise<StorageUploadResult> {
    await this.ensureBucket();
    const cleanKey = this.sanitizeKey(key);
    const contentType = options?.contentType || this.detectContentType(cleanKey);

    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.config.bucket,
          Key: cleanKey,
          Body: data,
          ContentType: contentType,
        })
      );
    } catch (err: any) {
      if (err.message && err.message.toLowerCase().includes('invalid hostname')) {
        Logger.error(
          'Storage:S3',
          `❌ MinIO/S3 rejected upload with: "${err.message}"\n` +
          `Diagnostic:\n` +
          ` 1. S3_ENDPOINT hostname contains underscores "_" (RFC 1123 violation). MinIO requires hyphens "-".\n` +
          ` 2. S3_ENDPOINT protocol is mismatched (e.g. https instead of http or vice versa).\n` +
          ` 3. MinIO requires S3_FORCE_PATH_STYLE=true.\n` +
          `Configured Endpoint: "${this.config.endpoint}", Bucket: "${this.config.bucket}"`
        );
      }
      throw err;
    }

    return {
      key: cleanKey,
      url: this.getUrl(cleanKey),
    };
  }

  public async uploadFromPath(
    key: string,
    localPath: string,
    options?: StorageUploadOptions
  ): Promise<StorageUploadResult> {
    const cleanKey = this.sanitizeKey(key);
    const fileBuffer = await fs.promises.readFile(localPath);
    const contentType = options?.contentType || this.detectContentType(localPath);

    return this.upload(cleanKey, fileBuffer, {
      ...options,
      contentType,
    });
  }

  public async download(key: string): Promise<Buffer> {
    const cleanKey = this.sanitizeKey(key);
    const response = await this.client.send(
      new GetObjectCommand({
        Bucket: this.config.bucket,
        Key: cleanKey,
      })
    );

    if (!response.Body) {
      throw new Error(`S3 Object "${cleanKey}" does not have a readable body.`);
    }

    const byteArray = await response.Body.transformToByteArray();
    return Buffer.from(byteArray);
  }

  public async delete(key: string): Promise<void> {
    const cleanKey = this.sanitizeKey(key);
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.config.bucket,
        Key: cleanKey,
      })
    );
  }

  public async exists(key: string): Promise<boolean> {
    const cleanKey = this.sanitizeKey(key);
    try {
      await this.client.send(
        new HeadObjectCommand({
          Bucket: this.config.bucket,
          Key: cleanKey,
        })
      );
      return true;
    } catch {
      return false;
    }
  }
}
