import crypto from "crypto";
import fs from "fs";
import path from "path";
import { ENV } from "../config/env.js";
import {
  BillingProfile,
  ParsedReceiptData,
  ReceiptTransactionRecord,
} from "../core/types.js";
import { StorageFactory } from "../infrastructure/storage/storageFactory.js";
import { IStorageService } from "../core/interfaces/IStorageService.js";
import { RedisHistoryService } from "../infrastructure/storage/redisHistory.js";

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
    return crypto.createHash("sha256").update(buffer).digest("hex");
  }

  /**
   * Sanitizes RFC for folder structure
   */
  public static sanitizeRfc(rfc?: string): string {
    const raw = (rfc || "").toString().trim().toUpperCase();
    return raw.replace(/[^A-Z0-9&Ñ]/g, "") || "TEMP";
  }

  /**
   * Resolves the local directory for this RFC's receipts
   */
  public static getLocalReceiptsDir(rfc?: string): string {
    const rfcFolder = this.sanitizeRfc(rfc);
    const dir = path.resolve(ENV.SCREENSHOT_DIR, rfcFolder, "receipts");
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
  }

  private static stripPrivateFiscalFields<T extends object>(record: T): T {
    const sanitized = {
      ...record,
    } as T & { razonSocial?: unknown; billingProfile?: unknown };
    delete sanitized.razonSocial;
    delete sanitized.billingProfile;
    return sanitized as T;
  }

  private static async findRecordForDeletion(
    rfc: string,
    entry: {
      id?: string;
      jobId?: string | number;
      fileHash?: string;
      trackingNumber?: string;
      receiptBaseName?: string;
      imageFileName?: string;
      jsonFileName?: string;
    },
  ): Promise<Partial<ReceiptTransactionRecord> | null> {
    const localDir = this.getLocalReceiptsDir(rfc);
    if (entry.receiptBaseName || entry.imageFileName || entry.jsonFileName) {
      const baseName =
        entry.receiptBaseName ||
        (entry.jsonFileName
          ? path.basename(entry.jsonFileName, ".json")
          : undefined) ||
        (entry.imageFileName
          ? path.basename(
              entry.imageFileName,
              path.extname(entry.imageFileName),
            )
          : undefined);
      return {
        id: baseName || entry.id || "",
        imageFileName:
          entry.imageFileName || (baseName ? `${baseName}.png` : ""),
        jsonFileName:
          entry.jsonFileName || (baseName ? `${baseName}.json` : ""),
        fileHash: entry.fileHash || "",
      };
    }

    if (!fs.existsSync(localDir)) return null;

    const jsonFiles = fs
      .readdirSync(localDir)
      .filter((fileName) => fileName.endsWith(".json"));
    const normalizedTracking = (entry.trackingNumber || "")
      .trim()
      .toUpperCase();
    for (const jsonFileName of jsonFiles) {
      try {
        const record = JSON.parse(
          fs.readFileSync(path.join(localDir, jsonFileName), "utf-8"),
        ) as Partial<ReceiptTransactionRecord>;
        const recordTracking = (record.ticket?.trackingNumber || "")
          .trim()
          .toUpperCase();
        const matches =
          (entry.jobId && String(record.jobId) === String(entry.jobId)) ||
          (entry.fileHash && record.fileHash === entry.fileHash) ||
          (normalizedTracking &&
            recordTracking &&
            normalizedTracking === recordTracking) ||
          (entry.id && record.id === entry.id);
        if (matches) {
          return {
            ...record,
            jsonFileName: record.jsonFileName || jsonFileName,
          };
        }
      } catch (err: any) {
        console.warn(
          `[ReceiptMetadataService] Could not inspect metadata file "${jsonFileName}" for deletion:`,
          err.message,
        );
      }
    }

    return null;
  }

  public static async deleteReceiptArtifacts(options: {
    rfc: string;
    entry: {
      id?: string;
      jobId?: string | number;
      fileHash?: string;
      trackingNumber?: string;
      receiptBaseName?: string;
      imageFileName?: string;
      jsonFileName?: string;
    };
  }): Promise<{ deletedKeys: string[]; missing: boolean }> {
    const rfcFolder = this.sanitizeRfc(options.rfc);
    const localDir = this.getLocalReceiptsDir(options.rfc);
    const record = await this.findRecordForDeletion(options.rfc, options.entry);
    if (!record) {
      return { deletedKeys: [], missing: true };
    }

    const baseName = record.id || options.entry.receiptBaseName;
    const imageFileName =
      record.imageFileName || (baseName ? `${baseName}.png` : undefined);
    const jsonFileName =
      record.jsonFileName || (baseName ? `${baseName}.json` : undefined);
    const fileNames = [imageFileName, jsonFileName].filter(
      (fileName): fileName is string => Boolean(fileName),
    );
    const storage = this.getStorage();
    const deletedKeys: string[] = [];

    for (const fileName of fileNames) {
      const storageKey = `${rfcFolder}/receipts/${fileName}`;
      try {
        await storage.delete(storageKey);
        deletedKeys.push(storageKey);
      } catch (err: any) {
        throw new Error(
          `No se pudo eliminar el artefacto de almacenamiento "${storageKey}": ${err.message}`,
        );
      }

      const localPath = path.join(localDir, fileName);
      try {
        if (fs.existsSync(localPath)) {
          fs.unlinkSync(localPath);
        }
      } catch (err: any) {
        throw new Error(
          `No se pudo eliminar el respaldo local "${fileName}": ${err.message}`,
        );
      }
    }

    return { deletedKeys, missing: deletedKeys.length === 0 };
  }

  /**
   * Checks if receipt hash has already been registered or processed
   */
  public static async isDuplicateHash(
    rfc: string,
    fileHash: string,
    options: { excludeBaseName?: string } = {},
  ): Promise<boolean> {
    if (!fileHash) return false;

    // The index must be strictly scoped to the user's RFC.
    // If no RFC is provided or it's a temporary unauthenticated upload, do not block.
    // Two users with different RFCs are permitted to upload the same receipt file.
    const cleanRfc = this.sanitizeRfc(rfc);
    if (!cleanRfc || cleanRfc === "TEMP") {
      return false;
    }

    // 1. Check if an active history record in Redis contains this hash for this RFC
    try {
      const history = await RedisHistoryService.getHistoryByRfc(cleanRfc);
      const hasHistoryEntry = history.some(
        (h) => h.fileHash === fileHash && h.status !== "failed",
      );
      if (hasHistoryEntry) {
        return true;
      }
    } catch (err: any) {
      console.warn(
        "[ReceiptMetadataService] Could not inspect Redis history for duplicate hash:",
        err.message,
      );
    }

    // 2. Check local disk JSON metadata files in this RFC's storage
    const localDir = this.getLocalReceiptsDir(cleanRfc);
    const jsonFiles = fs.existsSync(localDir)
      ? fs
          .readdirSync(localDir)
          .filter((fileName) => fileName.endsWith(".json"))
      : [];

    let foundInStorage = false;
    for (const jsonFileName of jsonFiles) {
      const baseName = path.basename(jsonFileName, ".json");
      if (options.excludeBaseName && baseName === options.excludeBaseName)
        continue;

      try {
        const record = JSON.parse(
          fs.readFileSync(path.join(localDir, jsonFileName), "utf-8"),
        ) as Partial<ReceiptTransactionRecord>;
        if (record.fileHash === fileHash) {
          foundInStorage = true;
          break;
        }
      } catch (err: any) {
        console.warn(
          `[ReceiptMetadataService] Could not inspect metadata file "${jsonFileName}" for duplicate hash:`,
          err.message,
        );
      }
    }

    if (foundInStorage) {
      // Keep Redis set in sync with storage for this RFC
      await RedisHistoryService.registerFileHash(cleanRfc, fileHash);
      return true;
    }

    // 3. If neither history nor storage contains the file, but Redis had it registered,
    // the files were deleted from storage externally. Auto-heal by removing the ghost hash from Redis.
    if (await RedisHistoryService.isFileHashRegistered(cleanRfc, fileHash)) {
      await RedisHistoryService.unregisterFileHash(cleanRfc, fileHash);
    }

    return false;
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
    const {
      rfc,
      baseName,
      fileHash,
      originalFilename,
      imageFileName,
      receiptImageUrl,
      parsed,
    } = options;
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
      status: "scanned",
      ticket: {
        trackingNumber: parsed.trackingNumber,
        stationNumber: parsed.stationNumber,
        cashier: parsed.cashier,
        gasStation: parsed.gasStation,
        transaction: parsed.transaction,
        date: parsed.date,
        paymentMethod: parsed.paymentMethod,
        amount: parsed.amount,
        liters: parsed.liters,
        subtotal: parsed.subtotal,
        iva: parsed.iva,
        billingUrl: parsed.billingUrl,
        address: parsed.address,
      },
      rawOcr: {
        fullText: parsed.rawText,
      },
    };

    const jsonString = JSON.stringify(
      this.stripPrivateFiscalFields(record),
      null,
      2,
    );

    // 1. Write local disk copy
    try {
      fs.writeFileSync(localJsonPath, jsonString, "utf-8");
    } catch (err: any) {
      console.warn(
        `[ReceiptMetadataService] Could not write local JSON backup to "${localJsonPath}":`,
        err.message,
      );
    }

    // 2. Upload to storage service
    const storageKey = `${rfcFolder}/receipts/${jsonFileName}`;
    try {
      const storage = this.getStorage();
      await storage.upload(storageKey, Buffer.from(jsonString, "utf-8"), {
        contentType: "application/json",
      });
    } catch (err: any) {
      console.warn(
        `[ReceiptMetadataService] Could not upload JSON to storage key "${storageKey}":`,
        err.message,
      );
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
    const { rfc, jobId, receiptData } = options;
    const rfcFolder = this.sanitizeRfc(rfc);
    const localDir = this.getLocalReceiptsDir(rfc);

    // Prefer the explicit receipt base-name convention; do not derive storage keys from public URLs.
    const baseName = receiptData.receiptBaseName || `receipt_${Date.now()}_0`;

    const jsonFileName = `${baseName}.json`;
    const localJsonPath = path.join(localDir, jsonFileName);

    if (
      await RedisHistoryService.isEntryTombstoned(rfcFolder, {
        id: baseName,
        jobId: String(jobId),
        fileHash: receiptData.fileHash,
        trackingNumber: receiptData.trackingNumber,
        receiptBaseName: baseName,
      })
    ) {
      return;
    }

    let existingRecord: Partial<ReceiptTransactionRecord> = {};
    if (fs.existsSync(localJsonPath)) {
      try {
        existingRecord = JSON.parse(fs.readFileSync(localJsonPath, "utf-8"));
      } catch (err: any) {
        console.warn(
          `[ReceiptMetadataService] Could not parse existing JSON for "${baseName}":`,
          err.message,
        );
      }
    }

    const updatedRecord: ReceiptTransactionRecord = {
      id: baseName,
      fileHash: receiptData.fileHash || existingRecord.fileHash || "",
      originalFilename: existingRecord.originalFilename || `${baseName}.png`,
      imageFileName: existingRecord.imageFileName || `${baseName}.png`,
      imageUrl:
        receiptData.receiptImageUrl ||
        existingRecord.imageUrl ||
        `/output/${rfcFolder}/receipts/${baseName}.png`,
      jsonFileName,
      jsonUrl: `/output/${rfcFolder}/receipts/${jsonFileName}`,
      rfc: rfc.trim().toUpperCase(),
      createdAt: existingRecord.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      submittedAt: new Date().toISOString(),
      status: "enqueued",
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
        liters: receiptData.liters || existingRecord.ticket?.liters,
        subtotal: receiptData.subtotal,
        iva: receiptData.iva,
        billingUrl: receiptData.billingUrl,
        address: receiptData.address || existingRecord.ticket?.address,
      },
      rawOcr:
        existingRecord.rawOcr ||
        (receiptData.rawText ? { fullText: receiptData.rawText } : undefined),
    };

    const jsonString = JSON.stringify(
      this.stripPrivateFiscalFields(updatedRecord),
      null,
      2,
    );

    // Save to disk
    try {
      fs.writeFileSync(localJsonPath, jsonString, "utf-8");
    } catch (err: any) {
      console.warn(
        `[ReceiptMetadataService] Could not update local JSON for "${baseName}":`,
        err.message,
      );
    }

    // Upload to storage
    const storageKey = `${rfcFolder}/receipts/${jsonFileName}`;
    try {
      const storage = this.getStorage();
      await storage.upload(storageKey, Buffer.from(jsonString, "utf-8"), {
        contentType: "application/json",
      });
    } catch (err: any) {
      console.warn(
        `[ReceiptMetadataService] Could not upload updated JSON to storage:`,
        err.message,
      );
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
    receiptBaseName?: string;
    status: "dry_run" | "completed" | "failed";
    submitted: boolean;
    pdfUrl?: string;
    screenshotUrl?: string;
    videoUrl?: string;
    message: string;
  }): Promise<void> {
    const {
      rfc,
      jobId,
      receiptBaseName,
      status,
      submitted,
      pdfUrl,
      screenshotUrl,
      videoUrl,
      message,
    } = options;
    const rfcFolder = this.sanitizeRfc(rfc);
    const localDir = this.getLocalReceiptsDir(rfc);

    const baseName = receiptBaseName;
    if (!baseName || !baseName.startsWith("receipt_")) return;

    const jsonFileName = `${baseName}.json`;
    const localJsonPath = path.join(localDir, jsonFileName);

    if (!fs.existsSync(localJsonPath)) return;

    try {
      const raw = fs.readFileSync(localJsonPath, "utf-8");
      const record = this.stripPrivateFiscalFields(
        JSON.parse(raw) as ReceiptTransactionRecord,
      );

      if (
        await RedisHistoryService.isEntryTombstoned(rfcFolder, {
          id: record.id,
          jobId: String(jobId),
          fileHash: record.fileHash,
          trackingNumber: record.ticket?.trackingNumber,
          receiptBaseName: record.id,
        })
      ) {
        return;
      }

      record.status = status === "completed" && !submitted ? "dry_run" : status;
      record.completedAt = new Date().toISOString();
      record.updatedAt = new Date().toISOString();
      record.invoiceResult = {
        submitted,
        pdfUrl,
        screenshotUrl,
        videoUrl,
        message,
      };

      const jsonString = JSON.stringify(
        this.stripPrivateFiscalFields(record),
        null,
        2,
      );
      fs.writeFileSync(localJsonPath, jsonString, "utf-8");

      const storage = this.getStorage();
      await storage.upload(
        `${rfcFolder}/receipts/${jsonFileName}`,
        Buffer.from(jsonString, "utf-8"),
        {
          contentType: "application/json",
        },
      );
    } catch (err: any) {
      console.warn(
        `[ReceiptMetadataService] Could not update JSON on outcome for "${baseName}":`,
        err.message,
      );
    }
  }

  /**
   * Retrieves all receipt metadata records stored for an RFC, verifying physical image files on disk
   */
  public static async getAllReceiptRecords(
    rfc: string,
  ): Promise<ReceiptTransactionRecord[]> {
    const rfcFolder = this.sanitizeRfc(rfc);
    if (!rfcFolder || rfcFolder === "TEMP") return [];

    const localDir = this.getLocalReceiptsDir(rfcFolder);
    if (!fs.existsSync(localDir)) return [];

    const jsonFiles = fs
      .readdirSync(localDir)
      .filter((fileName) => fileName.endsWith(".json"));

    const records: ReceiptTransactionRecord[] = [];
    for (const jsonFileName of jsonFiles) {
      try {
        const fullPath = path.join(localDir, jsonFileName);
        const content = fs.readFileSync(fullPath, "utf-8");
        const record = JSON.parse(content) as ReceiptTransactionRecord;
        if (record && record.id) {
          const baseName = record.id;
          let realImageFileName = record.imageFileName;
          if (!realImageFileName || !fs.existsSync(path.join(localDir, realImageFileName))) {
            for (const ext of [".jpeg", ".jpg", ".png", ".webp"]) {
              if (fs.existsSync(path.join(localDir, `${baseName}${ext}`))) {
                realImageFileName = `${baseName}${ext}`;
                break;
              }
            }
          }
          if (realImageFileName && fs.existsSync(path.join(localDir, realImageFileName))) {
            record.imageFileName = realImageFileName;
            record.imageUrl = `/output/${rfcFolder}/receipts/${realImageFileName}`;
          }
          records.push(record);
        }
      } catch (err: any) {
        console.warn(
          `[ReceiptMetadataService] Could not parse metadata file "${jsonFileName}":`,
          err.message,
        );
      }
    }
    return records;
  }

  /**
   * Rehydrates Redis history and hash cache from persistent Storage JSON files,
   * pruning stale ghost entries from Redis that no longer exist on disk.
   */
  public static async rehydrateRedisIndex(rfc: string): Promise<void> {
    const rfcFolder = this.sanitizeRfc(rfc);
    if (!rfcFolder || rfcFolder === "TEMP") return;

    const records = await this.getAllReceiptRecords(rfcFolder);
    const localDir = this.getLocalReceiptsDir(rfcFolder);
    const existingHistory = await RedisHistoryService.getHistoryByRfc(rfcFolder);

    // 1. Prune ghost records from Redis that no longer exist on disk (unless actively waiting/running in BullMQ)
    const validIds = new Set(records.map((r) => r.id));
    const validHashes = new Set(records.map((r) => r.fileHash).filter(Boolean));

    for (const entry of existingHistory) {
      const isJobActive = entry.status === "waiting" || entry.status === "active";
      if (isJobActive) continue;

      const hasMatchingRecord =
        validIds.has(entry.id || "") ||
        validIds.has(entry.receiptBaseName || "") ||
        (entry.fileHash && validHashes.has(entry.fileHash));

      const jsonFileExists = entry.jsonFileName
        ? fs.existsSync(path.join(localDir, entry.jsonFileName))
        : false;

      if (!hasMatchingRecord && !jsonFileExists) {
        if (entry.id) {
          await RedisHistoryService.removeStaleEntry(rfcFolder, entry.id);
        }
        if (entry.fileHash && !validHashes.has(entry.fileHash)) {
          await RedisHistoryService.unregisterFileHash(rfcFolder, entry.fileHash);
        }
      }
    }

    // 2. Upsert valid records from disk into Redis
    for (const r of records) {
      const isTombstoned = await RedisHistoryService.isEntryTombstoned(
        rfcFolder,
        {
          id: r.id,
          fileHash: r.fileHash,
          trackingNumber: r.ticket?.trackingNumber,
          receiptBaseName: r.id,
        },
      );
      if (isTombstoned) continue;

      const imgUrl =
        r.imageUrl ||
        (r.imageFileName ? `/output/${rfcFolder}/receipts/${r.imageFileName}` : undefined);

      await RedisHistoryService.upsertEntry({
        id: r.id,
        jobId: r.jobId,
        rfc: rfcFolder,
        razonSocial: "",
        trackingNumber: r.ticket?.trackingNumber || "---",
        gasStation: r.ticket?.gasStation || "Gasolinera",
        stationNumber: r.ticket?.stationNumber,
        cashier: r.ticket?.cashier,
        address: r.ticket?.address,
        paymentMethod: r.ticket?.paymentMethod,
        liters: r.ticket?.liters,
        fileHash: r.fileHash,
        receiptJsonUrl: r.jsonUrl || `/output/${rfcFolder}/receipts/${r.id}.json`,
        receiptBaseName: r.id,
        imageFileName: r.imageFileName,
        jsonFileName: r.jsonFileName || `${r.id}.json`,
        billingUrl: r.ticket?.billingUrl,
        amount: r.ticket?.amount || 0,
        date: r.ticket?.date || (r.createdAt ? r.createdAt.split("T")[0] : ""),
        timestamp: r.createdAt || new Date().toISOString(),
        status: (r.status as any) || "completed",
        submitted: Boolean(r.invoiceResult?.submitted),
        screenshotUrl: r.invoiceResult?.screenshotUrl,
        videoUrl: r.invoiceResult?.videoUrl,
        pdfUrl: r.invoiceResult?.pdfUrl,
        receiptImageUrl: imgUrl,
        message: r.invoiceResult?.message || "Factura registrada",
      });

      if (r.fileHash) {
        await RedisHistoryService.registerFileHash(rfcFolder, r.fileHash);
      }
    }
  }
}

