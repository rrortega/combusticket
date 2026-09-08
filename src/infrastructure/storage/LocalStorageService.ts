import fs from 'fs';
import path from 'path';
import {
  IStorageService,
  StorageUploadOptions,
  StorageUploadResult,
} from '../../core/interfaces/IStorageService.js';
import { ENV } from '../../config/env.js';

export class LocalStorageService implements IStorageService {
  public readonly driverName = 'local';
  private readonly baseDir: string;

  constructor(baseDir?: string) {
    this.baseDir = path.resolve(baseDir || ENV.SCREENSHOT_DIR);
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
  }

  public async init(): Promise<void> {
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
  }

  private sanitizeKey(key: string): string {
    return key
      .replace(/\\/g, '/')
      .replace(/^(\.\.[\/\\])+/, '')
      .replace(/^\/+/, '')
      .replace(/^output\//, '');
  }

  public async upload(
    key: string,
    data: Buffer | Uint8Array,
    _options?: StorageUploadOptions
  ): Promise<StorageUploadResult> {
    const cleanKey = this.sanitizeKey(key);
    const destination = path.join(this.baseDir, cleanKey);
    const destinationDir = path.dirname(destination);

    if (!fs.existsSync(destinationDir)) {
      await fs.promises.mkdir(destinationDir, { recursive: true });
    }

    await fs.promises.writeFile(destination, data);

    return {
      key: cleanKey,
      url: this.getUrl(cleanKey),
    };
  }

  public async uploadFromPath(
    key: string,
    localPath: string,
    _options?: StorageUploadOptions
  ): Promise<StorageUploadResult> {
    const cleanKey = this.sanitizeKey(key);
    const destination = path.join(this.baseDir, cleanKey);
    const destinationDir = path.dirname(destination);

    if (path.resolve(localPath) !== path.resolve(destination)) {
      if (!fs.existsSync(destinationDir)) {
        await fs.promises.mkdir(destinationDir, { recursive: true });
      }
      await fs.promises.copyFile(localPath, destination);
    }

    return {
      key: cleanKey,
      url: this.getUrl(cleanKey),
    };
  }

  public getUrl(key: string): string {
    const cleanKey = this.sanitizeKey(key);
    return `/output/${cleanKey}`;
  }

  public async download(key: string): Promise<Buffer> {
    const cleanKey = this.sanitizeKey(key);
    const filePath = path.join(this.baseDir, cleanKey);
    return fs.promises.readFile(filePath);
  }

  public async delete(key: string): Promise<void> {
    const cleanKey = this.sanitizeKey(key);
    const filePath = path.join(this.baseDir, cleanKey);
    if (fs.existsSync(filePath)) {
      await fs.promises.unlink(filePath);
    }
  }

  public async exists(key: string): Promise<boolean> {
    const cleanKey = this.sanitizeKey(key);
    const filePath = path.join(this.baseDir, cleanKey);
    return fs.existsSync(filePath);
  }
}
