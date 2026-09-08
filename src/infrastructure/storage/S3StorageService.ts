import fs from 'fs';
import path from 'path';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import {
  IStorageService,
  StorageUploadOptions,
  StorageUploadResult,
} from '../../core/interfaces/IStorageService.js';

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
          console.error(
            `\n[S3StorageService] ⚠️ CRITICAL WARNING: S3/MinIO endpoint hostname "${u.hostname}" contains an underscore ("_").` +
            `\nRFC 1123 / DNS standards forbid underscores in hostnames. MinIO will reject requests with: "Invalid Request (invalid hostname)".` +
            `\nACTION REQUIRED: Rename your Docker service/container or domain to use hyphens (e.g., "minio-service" instead of "minio_service").\n`
          );
        }
      } catch (err: any) {
        console.warn(`[S3StorageService] Warning: Could not parse endpoint URL "${normalizedEndpoint}":`, err.message);
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

  public async upload(
    key: string,
    data: Buffer | Uint8Array,
    options?: StorageUploadOptions
  ): Promise<StorageUploadResult> {
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
        console.error(
          `\n[S3StorageService] ❌ MinIO/S3 rejected upload with: "${err.message}"\n` +
          `Diagnostic: This occurs when:\n` +
          ` 1. S3_ENDPOINT hostname contains underscores "_" (RFC 1123 violation). MinIO requires hyphens "-".\n` +
          ` 2. S3_ENDPOINT protocol is mismatched (e.g. https instead of http or vice versa).\n` +
          ` 3. MinIO requires S3_FORCE_PATH_STYLE=true.\n` +
          `Configured Endpoint: "${this.config.endpoint}", Bucket: "${this.config.bucket}"\n`
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
