import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { ENV } from '../config/env.js';
import {
  BillingProfile,
  ParsedReceiptData,
  ReceiptTransactionRecord,
} from '../core/types.js';
import { StorageFactory } from '../infrastructure/storage/storageFactory.js';
import { IStorageService } from '../core/interfaces/IStorageService.js';
import { RedisHistoryService } from '../infrastructure/storage/redisHistory.js';

export class ReceiptMetadataService {
  private static storageService: IStorageService | null = null;

  private static getStorage(): IStorageService {
    if (!this.storageService) {
      this.storageService = StorageFactory.getStorageService();
    }
    return this.storageService;
  }

  /**
   * Calculates SHA-256 cryptographic hash of receipt image buffer
   */
  public static computeFileHash(buffer: Buffer | Uint8Array): string {
    return crypto.createHash('sha256').update(buffer).digest('hex');
  }

  /**
   * Sanitizes RFC for folder structure
   */
  public static sanitizeRfc(rfc?: string): string {
    const raw = (rfc || '').toString().trim().toUpperCase();
    return raw.replace(/[^A-Z0-9&Ñ]/g, '') || 'TEMP';
  }

  /**
   * Resolves the local directory for this RFC's receipts
   */
  public static getLocalReceiptsDir(rfc?: string): string {
    const rfcFolder = this.sanitizeRfc(rfc);
    const dir = path.resolve(ENV.SCREENSHOT_DIR, rfcFolder, 'receipts');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
  }

  /**
   * Checks if receipt hash has already been registered or processed
   */
  public static async isDuplicateHash(rfc: string, fileHash: string): Promise<boolean> {
    return RedisHistoryService.isFileHashRegistered(rfc, fileHash);
  }

  /**
   * Creates and persists a companion receipt JSON file (named identically to receipt with .json extension)
   * on both local disk and configured storage (MinIO / S3 / Local).
   */
  public static async saveScannedMetadata(options: {
    rfc: string;
    baseName: string; // e.g. receipt_1788899016033_0
    fileHash: string;
    originalFilename: string;
    imageFileName: string;
    receiptImageUrl: string;
    parsed: ParsedReceiptData;
  }): Promise<ReceiptTransactionRecord> {
    const { rfc, baseName, fileHash, originalFilename, imageFileName, receiptImageUrl, parsed } = options;
    const rfcFolder = this.sanitizeRfc(rfc);
    const localDir = this.getLocalReceiptsDir(rfc);
    const jsonFileName = `${baseName}.json`;
    const localJsonPath = path.join(localDir, jsonFileName);

    const record: ReceiptTransactionRecord = {
      id: baseName,
      fileHash,
      originalFilename,
      imageFileName,
      imageUrl: receiptImageUrl,
      jsonFileName,
      jsonUrl: `/output/${rfcFolder}/receipts/${jsonFileName}`,
      rfc: rfc.trim().toUpperCase(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: 'scanned',
      ticket: {
        trackingNumber: parsed.trackingNumber,
        stationNumber: parsed.stationNumber,
        cashier: parsed.cashier,
        gasStation: parsed.gasStation,
        transaction: parsed.transaction,
        date: parsed.date,
        paymentMethod: parsed.paymentMethod,
        amount: parsed.amount,
        subtotal: parsed.subtotal,
        iva: parsed.iva,
        billingUrl: parsed.billingUrl,
      },
      rawOcr: {
        fullText: parsed.rawText,
      },
    };

    const jsonString = JSON.stringify(record, null, 2);

    // 1. Write local disk copy
    try {
      fs.writeFileSync(localJsonPath, jsonString, 'utf-8');
    } catch (err: any) {
      console.warn(`[ReceiptMetadataService] Could not write local JSON backup to "${localJsonPath}":`, err.message);
    }

    // 2. Upload to storage service
    const storageKey = `${rfcFolder}/receipts/${jsonFileName}`;
    try {
      const storage = this.getStorage();
      await storage.upload(storageKey, Buffer.from(jsonString, 'utf-8'), {
        contentType: 'application/json',
      });
    } catch (err: any) {
      console.warn(`[ReceiptMetadataService] Could not upload JSON to storage key "${storageKey}":`, err.message);
    }

    return record;
  }

  /**
   * Updates companion JSON file when invoice is enqueued with final confirmed user fields
   */
  public static async updateOnEnqueue(options: {
    rfc: string;
    jobId: string | number;
    receiptData: ParsedReceiptData;
    billingProfile: BillingProfile;
  }): Promise<void> {
    const { rfc, jobId, receiptData, billingProfile } = options;
    const rfcFolder = this.sanitizeRfc(rfc);
    const localDir = this.getLocalReceiptsDir(rfc);

    // Try to derive baseName from receiptBaseName or receiptImageUrl
    let baseName = receiptData.receiptBaseName;
    if (!baseName && receiptData.receiptImageUrl) {
      const parsedName = path.basename(receiptData.receiptImageUrl, path.extname(receiptData.receiptImageUrl));
      if (parsedName.startsWith('receipt_')) {
        baseName = parsedName;
      }
    }
    if (!baseName) {
      baseName = `receipt_${Date.now()}_0`;
    }

    const jsonFileName = `${baseName}.json`;
    const localJsonPath = path.join(localDir, jsonFileName);

    let existingRecord: Partial<ReceiptTransactionRecord> = {};
    if (fs.existsSync(localJsonPath)) {
      try {
        existingRecord = JSON.parse(fs.readFileSync(localJsonPath, 'utf-8'));
      } catch {}
    }

    const updatedRecord: ReceiptTransactionRecord = {
      id: baseName,
      fileHash: receiptData.fileHash || existingRecord.fileHash || '',
      originalFilename: existingRecord.originalFilename || `${baseName}.png`,
      imageFileName: existingRecord.imageFileName || `${baseName}.png`,
      imageUrl: receiptData.receiptImageUrl || existingRecord.imageUrl || `/output/${rfcFolder}/receipts/${baseName}.png`,
      jsonFileName,
      jsonUrl: `/output/${rfcFolder}/receipts/${jsonFileName}`,
      rfc: rfc.trim().toUpperCase(),
      razonSocial: billingProfile.razonSocial,
      createdAt: existingRecord.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      submittedAt: new Date().toISOString(),
      status: 'enqueued',
      jobId: String(jobId),
      ticket: {
        trackingNumber: receiptData.trackingNumber,
        stationNumber: receiptData.stationNumber,
        cashier: receiptData.cashier,
        gasStation: receiptData.gasStation,
        transaction: receiptData.transaction,
        date: receiptData.date,
        paymentMethod: receiptData.paymentMethod,
        amount: receiptData.amount,
        subtotal: receiptData.subtotal,
        iva: receiptData.iva,
        billingUrl: receiptData.billingUrl,
      },
      billingProfile: {
        rfc: billingProfile.rfc,
        razonSocial: billingProfile.razonSocial,
        email: billingProfile.email,
        codigoPostal: billingProfile.codigoPostal,
        regimenFiscal: billingProfile.regimenFiscal,
        usoCfdi: billingProfile.usoCfdi,
        formaPago: billingProfile.formaPago,
      },
      rawOcr: existingRecord.rawOcr || (receiptData.rawText ? { fullText: receiptData.rawText } : undefined),
    };

    const jsonString = JSON.stringify(updatedRecord, null, 2);

    // Save to disk
    try {
      fs.writeFileSync(localJsonPath, jsonString, 'utf-8');
    } catch (err: any) {
      console.warn(`[ReceiptMetadataService] Could not update local JSON for "${baseName}":`, err.message);
    }

    // Upload to storage
    const storageKey = `${rfcFolder}/receipts/${jsonFileName}`;
    try {
      const storage = this.getStorage();
      await storage.upload(storageKey, Buffer.from(jsonString, 'utf-8'), {
        contentType: 'application/json',
      });
    } catch (err: any) {
      console.warn(`[ReceiptMetadataService] Could not upload updated JSON to storage:`, err.message);
    }

    // Register hash in Redis permanent set
    if (updatedRecord.fileHash) {
      await RedisHistoryService.registerFileHash(rfc, updatedRecord.fileHash);
    }
  }

  /**
   * Updates companion JSON file when invoice job completes or fails
   */
  public static async updateOnOutcome(options: {
    rfc: string;
    jobId: string | number;
    receiptImageUrl?: string;
    status: 'completed' | 'failed';
    submitted: boolean;
    pdfUrl?: string;
    screenshotUrl?: string;
    videoUrl?: string;
    message: string;
  }): Promise<void> {
    const { rfc, receiptImageUrl, status, submitted, pdfUrl, screenshotUrl, videoUrl, message } = options;
    const rfcFolder = this.sanitizeRfc(rfc);
    const localDir = this.getLocalReceiptsDir(rfc);

    if (!receiptImageUrl) return;

    const baseName = path.basename(receiptImageUrl, path.extname(receiptImageUrl));
    if (!baseName || !baseName.startsWith('receipt_')) return;

    const jsonFileName = `${baseName}.json`;
    const localJsonPath = path.join(localDir, jsonFileName);

    if (!fs.existsSync(localJsonPath)) return;

    try {
      const raw = fs.readFileSync(localJsonPath, 'utf-8');
      const record = JSON.parse(raw) as ReceiptTransactionRecord;

      record.status = status;
      record.completedAt = new Date().toISOString();
      record.updatedAt = new Date().toISOString();
      record.invoiceResult = {
        submitted,
        pdfUrl,
        screenshotUrl,
        videoUrl,
        message,
      };

      const jsonString = JSON.stringify(record, null, 2);
      fs.writeFileSync(localJsonPath, jsonString, 'utf-8');

      const storage = this.getStorage();
      await storage.upload(`${rfcFolder}/receipts/${jsonFileName}`, Buffer.from(jsonString, 'utf-8'), {
        contentType: 'application/json',
      });
    } catch (err: any) {
      console.warn(`[ReceiptMetadataService] Could not update JSON on outcome for "${baseName}":`, err.message);
    }
  }
}
