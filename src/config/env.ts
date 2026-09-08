import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

export const ENV = {
  PORT: parseInt(process.env.PORT || '4000', 10),
  HOST: process.env.HOST || '0.0.0.0',
  APP_MODE: (process.env.APP_MODE || process.env.SERVICE_ROLE || process.env.MODE || 'all').toLowerCase().trim(),
  REDIS_URL: process.env.REDIS_URL || 'redis://127.0.0.1:6379',
  RECORD_VIDEO: process.env.RECORD_VIDEO === 'true',
  DRY_RUN: process.env.DRY_RUN === 'true', // defaults to false (real submit with "Solicitar Factura")
  SCREENSHOT_DIR: path.resolve(process.env.SCREENSHOT_DIR || 'output'),
  VIDEO_DIR: path.resolve(process.env.VIDEO_DIR || 'output/videos'),
  // Storage Driver: 'local' | 's3' | 'minio'
  STORAGE_DRIVER: (process.env.STORAGE_DRIVER || 'local').toLowerCase().trim(),
  S3_BUCKET: process.env.S3_BUCKET || 'combusticket',
  S3_REGION: process.env.S3_REGION || 'us-east-1',
  S3_ENDPOINT: process.env.S3_ENDPOINT || '',
  S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID || '',
  S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY || '',
  S3_FORCE_PATH_STYLE:
    process.env.S3_FORCE_PATH_STYLE !== undefined
      ? process.env.S3_FORCE_PATH_STYLE === 'true'
      : undefined,
  S3_PUBLIC_URL: process.env.S3_PUBLIC_URL || '',
};
