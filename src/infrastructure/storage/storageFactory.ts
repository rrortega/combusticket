import { IStorageService } from '../../core/interfaces/IStorageService.js';
import { LocalStorageService } from './LocalStorageService.js';
import { S3StorageService } from './S3StorageService.js';
import { ENV } from '../../config/env.js';

export class StorageFactory {
  private static instance: IStorageService | null = null;

  public static getStorageService(): IStorageService {
    if (!this.instance) {
      this.instance = this.createStorageService();
    }
    return this.instance;
  }

  public static createStorageService(): IStorageService {
    const driver = ENV.STORAGE_DRIVER;

    if (driver === 's3' || driver === 'minio') {
      const isMinio = driver === 'minio' || Boolean(ENV.S3_ENDPOINT);
      const forcePathStyle =
        ENV.S3_FORCE_PATH_STYLE !== undefined
          ? ENV.S3_FORCE_PATH_STYLE
          : isMinio;

      console.log(
        `[StorageFactory] Initializing S3/MinIO Storage Service (driver="${driver}", bucket="${ENV.S3_BUCKET}", endpoint="${ENV.S3_ENDPOINT || 'aws-default'}", forcePathStyle=${forcePathStyle})`
      );

      return new S3StorageService({
        bucket: ENV.S3_BUCKET,
        region: ENV.S3_REGION,
        endpoint: ENV.S3_ENDPOINT || undefined,
        accessKeyId: ENV.S3_ACCESS_KEY_ID || undefined,
        secretAccessKey: ENV.S3_SECRET_ACCESS_KEY || undefined,
        forcePathStyle,
        publicUrl: ENV.S3_PUBLIC_URL || undefined,
      });
    }

    console.log(
      `[StorageFactory] Initializing Local Disk Storage Service (dir="${ENV.SCREENSHOT_DIR}")`
    );
    return new LocalStorageService(ENV.SCREENSHOT_DIR);
  }

  public static resetInstance(): void {
    this.instance = null;
  }
}
