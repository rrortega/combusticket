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
    this.config = config;

    const isMinioOrCustomEndpoint = Boolean(config.endpoint);
    const forcePathStyle =
      config.forcePathStyle !== undefined
        ? config.forcePathStyle
        : isMinioOrCustomEndpoint;

    this.client = new S3Client({
      region: config.region || 'us-east-1',
      endpoint: config.endpoint || undefined,
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

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: cleanKey,
        Body: data,
        ContentType: contentType,
      })
    );

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
