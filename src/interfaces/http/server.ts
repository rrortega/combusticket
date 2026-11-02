import express, { Request, Response, NextFunction } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { ENV } from "../../config/env.js";
import { GasInvoiceService } from "../../services/gasInvoiceService.js";
import {
  BillingProfile,
  ParsedReceiptData,
  ReceiptTransactionRecord,
} from "../../core/types.js";
import {
  getInvoiceQueue,
  addInvoiceJob,
} from "../../infrastructure/queue/invoiceQueue.js";
import { startInvoiceWorker } from "../../infrastructure/queue/invoiceWorker.js";
import { RedisHistoryService } from "../../infrastructure/storage/redisHistory.js";
import {
  RegimenesFiscalesCatalog,
  UsosCfdiCatalog,
  FormasPagoCatalog,
} from "../../../config/catalogs/index.js";
import { StorageFactory } from "../../infrastructure/storage/storageFactory.js";
import { S3StorageService } from "../../infrastructure/storage/S3StorageService.js";
import { PushNotificationService } from "../../infrastructure/notifications/pushNotificationService.js";
import { ReceiptMetadataService } from "../../services/receiptMetadataService.js";

const REJECTION_MESSAGE_REGEX =
  /rechaz[oó]|inv[aá]lido|incorrecto|no\s*admiti[oó]|no\s*existe|no\s*encontrado|ya\s*(?:fue|hab[ií]a\s*sido|se\s*encuentra)\s*facturado|no\s*avanz[oó]|no\s*devolvi[oó]\s*confirmaci[oó]n|no\s*se\s*pudo\s*confirmar|error|fall[oó]|alerta\s*del\s*portal|demasiados\s*intentos|fuera\s*de\s*tiempo|vencido|faltan\s*datos/i;

const POSITIVE_SUCCESS_MESSAGE_REGEX =
  /factura\s*(?:solicitada|generada|emitida|creada|enviada|registrada)|comprobante\s*fiscal|simulaci[oó]n\s*completada/i;

function normalizePublicMediaUrl(url?: string): string | undefined {
  return S3StorageService.normalizePublicUrl(
    url,
    ENV.S3_BUCKET,
    ENV.S3_PUBLIC_URL,
  );
}

function getContentTypeForExtension(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".webp":
      return "image/webp";
    case ".webm":
      return "video/webm";
    case ".mp4":
      return "video/mp4";
    case ".pdf":
      return "application/pdf";
    case ".xml":
      return "application/xml";
    case ".json":
      return "application/json";
    default:
      return "application/octet-stream";
  }
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB per file
});

export async function createHttpServer(
  port: number = ENV.PORT,
  options: { enableWorker?: boolean; host?: string } = {},
) {
  const app = express();

  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ extended: true, limit: "50mb" }));

  const storageService = StorageFactory.getStorageService();

  // Service Worker must never be cached by browser HTTP cache so byte changes trigger instant updates
  app.get("/sw.js", (_req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.setHeader("Content-Type", "application/javascript");
    return res.sendFile(path.resolve(process.cwd(), "public", "sw.js"));
  });

  // Serve static assets: Web Application, screenshots, videos, and fixtures
  app.use(express.static(path.resolve(process.cwd(), "public")));
  app.use("/output", express.static(ENV.SCREENSHOT_DIR));
  app.use("/output/videos", express.static(ENV.VIDEO_DIR));
  app.use("/output", async (req: Request, res: Response, next: NextFunction) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      return next();
    }
    try {
      let key = decodeURIComponent(req.path || "").replace(/^\/+/, "");
      const bucketPrefix = `${(ENV.S3_BUCKET || "combusticket").trim().toLowerCase()}/`;
      if (key.toLowerCase().startsWith(bucketPrefix)) {
        key = key.slice(bucketPrefix.length);
      }
      if (!key) {
        return res.status(404).end();
      }
      const buffer = await storageService.download(key);
      res.setHeader("Content-Type", getContentTypeForExtension(key));
      res.setHeader("Cache-Control", "public, max-age=3600");
      return res.send(buffer);
    } catch {
      return res.status(404).end();
    }
  });
  app.use("/fixtures", express.static(path.resolve(process.cwd(), "fixtures")));

  const service = await GasInvoiceService.createDefault({
    storageService,
  });

  // Start background BullMQ worker if enabled (disabled in dedicated web / api mode)
  const shouldStartWorker =
    options.enableWorker === undefined
      ? ENV.APP_MODE === "all" || ENV.APP_MODE === "worker"
      : options.enableWorker;

  const worker = shouldStartWorker ? startInvoiceWorker() : null;
  if (worker) {
    console.log(
      "[GasInvoice HTTP API] Background BullMQ worker started in this process.",
    );
  } else {
    console.log(
      "[GasInvoice HTTP API] Running in dedicated Web/API mode (Worker disabled in this process).",
    );
  }

  // Health check
  app.get("/health", (_req: Request, res: Response) => {
    res.json({
      status: "ok",
      mode: ENV.APP_MODE,
      storageDriver: ENV.STORAGE_DRIVER,
      storageBucket: ENV.STORAGE_DRIVER === "local" ? undefined : ENV.S3_BUCKET,
      workerActive: Boolean(worker),
      uptime: process.uptime(),
      redis: ENV.REDIS_URL,
      recordVideo: ENV.RECORD_VIDEO,
      dryRun: ENV.DRY_RUN,
      takeScreenshot: ENV.TAKE_SCREENSHOT,
      timestamp: new Date().toISOString(),
    });
  });

  // Public server configuration
  app.get("/api/config", (_req: Request, res: Response) => {
    res.json({
      success: true,
      storageDriver: ENV.STORAGE_DRIVER,
      recordVideo: ENV.RECORD_VIDEO,
      dryRun: ENV.DRY_RUN,
      takeScreenshot: ENV.TAKE_SCREENSHOT,
    });
  });

  // Web Push Notifications
  app.get("/api/push/public-key", (_req: Request, res: Response) => {
    res.json({
      success: true,
      publicKey: PushNotificationService.getPublicKey(),
    });
  });

  app.post("/api/push/subscribe", async (req: Request, res: Response) => {
    try {
      const { subscription, rfc } = req.body;
      if (!subscription || !subscription.endpoint || !subscription.keys) {
        return res.status(400).json({
          success: false,
          error: "Suscripción Web Push inválida o incompleta.",
        });
      }

      await PushNotificationService.saveSubscription(subscription, rfc);
      return res.json({
        success: true,
        message: "Suscripción push guardada con éxito.",
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post("/api/push/unsubscribe", async (req: Request, res: Response) => {
    try {
      const { endpoint, rfc } = req.body;
      if (!endpoint) {
        return res
          .status(400)
          .json({ success: false, error: "Endpoint es requerido." });
      }

      await PushNotificationService.removeSubscription(endpoint, rfc);
      return res.json({ success: true, message: "Suscripción cancelada." });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post("/api/push/test", async (req: Request, res: Response) => {
    try {
      const { rfc } = req.body;
      const count = rfc
        ? await PushNotificationService.sendToRfc(rfc, {
            title: "🔔 CombusTicket Test",
            body: "¡Las notificaciones push están funcionando correctamente!",
            data: { url: "/" },
          })
        : await PushNotificationService.broadcast({
            title: "🔔 CombusTicket Test",
            body: "¡Las notificaciones push están funcionando correctamente!",
            data: { url: "/" },
          });

      return res.json({ success: true, deliveredCount: count });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // Catalogs (Régimen Fiscal, Uso CFDI, Formas de Pago)
  app.get("/api/catalogs", (_req: Request, res: Response) => {
    res.json({
      success: true,
      regimenes: RegimenesFiscalesCatalog,
      usosCfdi: UsosCfdiCatalog,
      formasPago: FormasPagoCatalog,
    });
  });

  // Supported gas stations catalog
  app.get("/api/stations", (_req: Request, res: Response) => {
    try {
      const stationsPath = path.resolve(
        process.cwd(),
        "config",
        "supported_stations.json",
      );
      if (fs.existsSync(stationsPath)) {
        const data = JSON.parse(fs.readFileSync(stationsPath, "utf-8"));
        return res.json({ success: true, stations: data });
      }
      return res.json({
        success: true,
        stations: [
          {
            id: "gogas",
            name: "GoGas",
            domain: "facturasgas.com",
            status: "active",
            statusText: "Disponible",
            description: "Red FacturasGas / GoGas",
          },
          {
            id: "lodemo",
            name: "Grupo Lodemo",
            domain: "lodemored.com.mx",
            portalUrl: "https://fact.lodemored.net/",
            status: "active",
            statusText: "Disponible",
            description: "Grupo Lodemo / LodemoRed / Zazil Ha",
          },
        ],
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Default / Test profile endpoint
  app.get("/api/profile", (_req: Request, res: Response) => {
    try {
      const profilePath = path.resolve(
        process.cwd(),
        "config",
        "billing_profile.json",
      );
      if (fs.existsSync(profilePath)) {
        const profile = JSON.parse(fs.readFileSync(profilePath, "utf-8"));
        return res.json({ success: true, profile });
      }
      return res.json({ success: false, profile: null });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // Save / Update profile endpoint
  app.post("/api/profile", (req: Request, res: Response) => {
    try {
      const profile = req.body;
      if (!profile || !profile.rfc) {
        return res
          .status(400)
          .json({ success: false, error: "Perfil inválido: falta RFC" });
      }
      const profilePath = path.resolve(
        process.cwd(),
        "config",
        "billing_profile.json",
      );
      fs.writeFileSync(profilePath, JSON.stringify(profile, null, 2), "utf-8");
      return res.json({ success: true, profile });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // Scan receipt(s) on-the-fly with OCR and return parsed metadata for user review/edit
  // Supports single or multiple files
  app.post(
    "/api/receipts/scan",
    upload.array("receipts", 1),
    async (req: Request, res: Response) => {
      try {
        const files = req.files as Express.Multer.File[];
        if (!files || files.length === 0) {
          return res.status(400).json({
            success: false,
            error:
              "No se subieron imágenes de recibos. Selecciona al menos un archivo.",
          });
        }

        // Extract and sanitize RFC for scoping storage and local folders
        const rawRfc = (req.body?.rfc || req.query?.rfc || "")
          .toString()
          .trim()
          .toUpperCase();
        const rfcFolder = ReceiptMetadataService.sanitizeRfc(rawRfc);
        const requestTimestamp = Date.now();
        const fileHashes = files.map((file) =>
          ReceiptMetadataService.computeFileHash(file.buffer),
        );
        const seenHashes = new Set<string>();
        const duplicateHashes: Array<{
          index: number;
          filename: string;
          fileHash: string;
        }> = [];

        for (let i = 0; i < fileHashes.length; i++) {
          const fileHash = fileHashes[i];
          if (seenHashes.has(fileHash)) {
            duplicateHashes.push({
              index: i,
              filename: files[i].originalname,
              fileHash,
            });
          } else if (
            rfcFolder !== "TEMP" &&
            (await ReceiptMetadataService.isDuplicateHash(rfcFolder, fileHash))
          ) {
            duplicateHashes.push({
              index: i,
              filename: files[i].originalname,
              fileHash,
            });
          }
          seenHashes.add(fileHash);
        }

        if (duplicateHashes.length > 0) {
          return res.status(409).json({
            success: false,
            error:
              "Ya tienes este recibo registrado en tu historial. No es posible subirlo nuevamente.",
            duplicateHashes,
          });
        }

        const stagingDir = path.resolve(ENV.SCREENSHOT_DIR, "TEMP", "staging");
        if (!fs.existsSync(stagingDir)) {
          fs.mkdirSync(stagingDir, { recursive: true });
        }

        const parsedResults: Array<{
          index: number;
          filename: string;
          success: boolean;
          receipt?: ParsedReceiptData;
          error?: string;
        }> = [];

        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          try {
            // 1. Run OCR FIRST on in-memory buffer so OCR never fails due to storage misconfiguration
            const parsed = await service.parseReceiptOnly(file.buffer);

            // 2. Save only to temporary staging folder for user preview (no permanent RFC storage or JSON pollution)
            const ext = path.extname(file.originalname) || ".png";
            const baseName = `receipt_${requestTimestamp}_${i}`;
            const fileHash = fileHashes[i];
            const stagingFileName = `${fileHash}${ext}`;
            const localStagingPath = path.join(stagingDir, stagingFileName);

            try {
              fs.writeFileSync(localStagingPath, file.buffer);
            } catch (writeErr: any) {
              console.warn(
                "[Server] Could not write staging receipt preview:",
                writeErr.message,
              );
            }

            // Preview URL points to ephemeral staging area
            const receiptImageUrl = `/output/TEMP/staging/${stagingFileName}`;

            parsed.receiptImageUrl = receiptImageUrl;
            parsed.receiptBaseName = baseName;
            parsed.fileHash = fileHash;
            parsed.receiptJsonUrl = undefined;

            parsedResults.push({
              index: i,
              filename: file.originalname,
              success: true,
              receipt: parsed,
            });
          } catch (ocrErr: any) {
            console.error(
              `[Server] OCR parsing failed for file "${file.originalname}":`,
              ocrErr.message,
            );
            parsedResults.push({
              index: i,
              filename: file.originalname,
              success: false,
              error:
                ocrErr.message || "No se pudo extraer texto del ticket con OCR",
            });
          }
        }

        res.json({
          success: true,
          count: parsedResults.length,
          results: parsedResults,
        });
      } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
      }
    },
  );

  // Upload receipt file(s) under user's RFC folder (or migrate existing scanned temp files)
  app.post(
    "/api/receipts/upload",
    upload.array("receipts", 10),
    async (req: Request, res: Response) => {
      try {
        const rawRfc = (req.body?.rfc || req.query?.rfc || "")
          .toString()
          .trim()
          .toUpperCase();
        const rfcFolder = ReceiptMetadataService.sanitizeRfc(rawRfc);
        if (!rawRfc) {
          return res.status(400).json({
            success: false,
            error: "RFC requerido para almacenar el recibo",
          });
        }

        const localRfcReceiptsDir = path.resolve(
          ENV.SCREENSHOT_DIR,
          rfcFolder,
          "receipts",
        );
        if (!fs.existsSync(localRfcReceiptsDir)) {
          fs.mkdirSync(localRfcReceiptsDir, { recursive: true });
        }

        const uploadedFiles: Array<{
          index: number;
          filename: string;
          receiptImageUrl: string;
          fileHash: string;
          receiptBaseName: string;
        }> = [];
        const files = (req.files as Express.Multer.File[]) || [];
        const uploadTimestamp = Date.now();
        const uploadedHashes = files.map((file) =>
          ReceiptMetadataService.computeFileHash(file.buffer),
        );
        const seenUploadHashes = new Set<string>();
        const duplicateUploadHashes: Array<{
          index: number;
          filename: string;
          fileHash: string;
        }> = [];

        for (let i = 0; i < uploadedHashes.length; i++) {
          const fileHash = uploadedHashes[i];
          if (seenUploadHashes.has(fileHash)) {
            duplicateUploadHashes.push({
              index: i,
              filename: files[i].originalname,
              fileHash,
            });
          } else if (
            rfcFolder !== "TEMP" &&
            (await ReceiptMetadataService.isDuplicateHash(rfcFolder, fileHash))
          ) {
            duplicateUploadHashes.push({
              index: i,
              filename: files[i].originalname,
              fileHash,
            });
          }
          seenUploadHashes.add(fileHash);
        }

        // Process migration sources before writing any new files so duplicates are rejected pre-acceptance.
        const existingUrlsRaw = req.body?.existingUrls;
        let existingUrls: string[] = [];
        if (typeof existingUrlsRaw === "string") {
          try {
            existingUrls = JSON.parse(existingUrlsRaw);
          } catch {
            existingUrls = [existingUrlsRaw];
          }
        } else if (Array.isArray(existingUrlsRaw)) {
          existingUrls = existingUrlsRaw;
        }

        for (let j = 0; j < existingUrls.length; j++) {
          const oldUrl = existingUrls[j];
          if (
            !oldUrl ||
            typeof oldUrl !== "string" ||
            oldUrl.includes(`/${rfcFolder}/receipts/`)
          )
            continue;
          const relativePath = oldUrl.startsWith("/output/")
            ? oldUrl.replace("/output/", "")
            : oldUrl.split("/output/")[1] || path.basename(oldUrl);
          const sourcePath = path.resolve(ENV.SCREENSHOT_DIR, relativePath);
          if (!fs.existsSync(sourcePath)) continue;
          const buffer = fs.readFileSync(sourcePath);
          const fileHash = ReceiptMetadataService.computeFileHash(buffer);
          if (seenUploadHashes.has(fileHash)) {
            duplicateUploadHashes.push({
              index: files.length + j,
              filename: path.basename(sourcePath),
              fileHash,
            });
          } else if (
            rfcFolder !== "TEMP" &&
            (await ReceiptMetadataService.isDuplicateHash(rfcFolder, fileHash))
          ) {
            duplicateUploadHashes.push({
              index: files.length + j,
              filename: path.basename(sourcePath),
              fileHash,
            });
          }
          seenUploadHashes.add(fileHash);
        }

        if (duplicateUploadHashes.length > 0) {
          return res.status(409).json({
            success: false,
            error:
              "Ya tienes este recibo registrado en tu historial. No es posible subirlo nuevamente.",
            duplicateHashes: duplicateUploadHashes,
          });
        }

        // 1. Process directly uploaded files from memory
        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          const ext = path.extname(file.originalname) || ".png";
          const receiptBaseName = `receipt_${uploadTimestamp}_${i}`;
          const savedFileName = `${receiptBaseName}${ext}`;
          const fileHash = uploadedHashes[i];
          const localFilePath = path.join(localRfcReceiptsDir, savedFileName);

          // Write local backup copy
          fs.writeFileSync(localFilePath, file.buffer);

          // Upload to storage (MinIO / S3 / Local)
          const key = `${rfcFolder}/receipts/${savedFileName}`;
          let receiptImageUrl = `/output/${rfcFolder}/receipts/${savedFileName}`;
          try {
            const uploadResult = await storageService.upload(key, file.buffer, {
              contentType: file.mimetype || "image/png",
            });
            if (uploadResult?.url) {
              receiptImageUrl =
                normalizePublicMediaUrl(uploadResult.url) || receiptImageUrl;
            }
          } catch (storageErr: any) {
            console.warn(
              `[Server] Storage upload failed for key "${key}":`,
              storageErr.message,
            );
          }

          uploadedFiles.push({
            index: i,
            filename: file.originalname,
            receiptImageUrl,
            fileHash,
            receiptBaseName,
          });
        }

        // 2. Process migration from existing URLs (e.g. from /output/TEMP/receipts/... or /output/GENERAL/...)
        const migratedFiles: Array<{
          originalUrl: string;
          receiptImageUrl: string;
          fileHash?: string;
          receiptBaseName?: string;
          receiptJsonUrl?: string;
        }> = [];
        for (let j = 0; j < existingUrls.length; j++) {
          const oldUrl = existingUrls[j];
          if (!oldUrl || typeof oldUrl !== "string") continue;
          try {
            const normalizedOldUrl = normalizePublicMediaUrl(oldUrl) || oldUrl;
            // If already in this RFC's folder, keep it
            if (normalizedOldUrl.includes(`/${rfcFolder}/receipts/`)) {
              const receiptBaseName = path.basename(
                normalizedOldUrl,
                path.extname(normalizedOldUrl),
              );
              migratedFiles.push({
                originalUrl: oldUrl,
                receiptImageUrl: normalizedOldUrl,
                receiptBaseName,
                receiptJsonUrl: `/output/${rfcFolder}/receipts/${receiptBaseName}.json`,
              });
              continue;
            }

            // Check if local file exists
            const relativePath = normalizedOldUrl.startsWith("/output/")
              ? normalizedOldUrl.replace("/output/", "")
              : normalizedOldUrl.split("/output/")[1] || path.basename(normalizedOldUrl);

            const sourcePath = path.resolve(ENV.SCREENSHOT_DIR, relativePath);
            if (fs.existsSync(sourcePath)) {
              const buffer = fs.readFileSync(sourcePath);
              const fileHash = ReceiptMetadataService.computeFileHash(buffer);
              const ext = path.extname(sourcePath) || ".png";
              const receiptBaseName = `receipt_${uploadTimestamp}_${files.length + j}`;
              const savedFileName = `${receiptBaseName}${ext}`;
              const destPath = path.join(localRfcReceiptsDir, savedFileName);

              fs.copyFileSync(sourcePath, destPath);

              const key = `${rfcFolder}/receipts/${savedFileName}`;
              let receiptImageUrl = `/output/${rfcFolder}/receipts/${savedFileName}`;
              try {
                const uploadResult = await storageService.upload(key, buffer, {
                  contentType: "image/png",
                });
                if (uploadResult?.url) {
                  receiptImageUrl =
                    normalizePublicMediaUrl(uploadResult.url) || receiptImageUrl;
                }
              } catch (storageErr: any) {
                console.warn(
                  `[Server] Storage upload failed for key "${key}":`,
                  storageErr.message,
                );
              }

              const sourceJsonPath = sourcePath.replace(
                path.extname(sourcePath),
                ".json",
              );
              const jsonFileName = `${receiptBaseName}.json`;
              const receiptJsonUrl = `/output/${rfcFolder}/receipts/${jsonFileName}`;
              if (fs.existsSync(sourceJsonPath)) {
                try {
                  const sourceRecord = JSON.parse(
                    fs.readFileSync(sourceJsonPath, "utf-8"),
                  ) as Partial<ReceiptTransactionRecord>;
                  const updatedRecord = {
                    ...sourceRecord,
                    id: receiptBaseName,
                    fileHash,
                    imageFileName: savedFileName,
                    imageUrl: receiptImageUrl,
                    jsonFileName,
                    jsonUrl: receiptJsonUrl,
                    rfc: rfcFolder,
                    updatedAt: new Date().toISOString(),
                  };
                  delete (
                    updatedRecord as Partial<ReceiptTransactionRecord> & {
                      razonSocial?: unknown;
                    }
                  ).razonSocial;
                  delete (
                    updatedRecord as Partial<ReceiptTransactionRecord> & {
                      billingProfile?: unknown;
                    }
                  ).billingProfile;
                  const jsonString = JSON.stringify(updatedRecord, null, 2);
                  fs.writeFileSync(
                    path.join(localRfcReceiptsDir, jsonFileName),
                    jsonString,
                    "utf-8",
                  );
                  await storageService.upload(
                    `${rfcFolder}/receipts/${jsonFileName}`,
                    Buffer.from(jsonString, "utf-8"),
                    {
                      contentType: "application/json",
                    },
                  );
                } catch (jsonErr: any) {
                  console.warn(
                    "[Server] Could not migrate companion receipt metadata:",
                    jsonErr.message,
                  );
                }
              }

              migratedFiles.push({
                originalUrl: oldUrl,
                receiptImageUrl,
                fileHash,
                receiptBaseName,
                receiptJsonUrl,
              });
            }
          } catch (migrErr: any) {
            console.warn(
              "[Server] Could not migrate existing receipt:",
              migrErr.message,
            );
          }
        }

        return res.json({
          success: true,
          rfc: rfcFolder,
          files: uploadedFiles,
          migrated: migratedFiles,
        });
      } catch (err: any) {
        return res.status(500).json({ success: false, error: err.message });
      }
    },
  );

  // Enqueue invoice job(s) in BullMQ
  app.post("/api/queue/invoice", async (req: Request, res: Response) => {
    try {
      const {
        items,
        receiptData,
        billingProfile,
        recordVideo,
        dryRun,
        takeScreenshot,
      } = req.body;

      if (!billingProfile || !billingProfile.rfc) {
        return res.status(400).json({
          success: false,
          error:
            "Faltan los datos del perfil de facturación (RFC es requerido).",
        });
      }

      const jobsToQueue: Array<{
        receiptData: ParsedReceiptData;
        billingProfile: BillingProfile;
      }> = [];

      if (Array.isArray(items) && items.length > 0) {
        for (const item of items) {
          if (item.receiptData) {
            jobsToQueue.push({
              receiptData: item.receiptData,
              billingProfile: item.billingProfile || billingProfile,
            });
          }
        }
      } else if (receiptData) {
        jobsToQueue.push({
          receiptData,
          billingProfile,
        });
      }

      if (jobsToQueue.length === 0) {
        return res.status(400).json({
          success: false,
          error: "No se enviaron datos de recibos para facturar.",
        });
      }

      // Safety check: Never allow invoicing to generic public RFC (XAXX010101000 / XEXX010101000 / PUBLICO EN GENERAL)
      const targetRfc = (billingProfile.rfc || "").trim().toUpperCase();
      if (
        !targetRfc ||
        targetRfc === "XAXX010101000" ||
        targetRfc === "XEXX010101000" ||
        /PUBLICO\s*(?:EN\s*)?GENERAL/i.test(billingProfile.razonSocial || "")
      ) {
        return res.status(400).json({
          success: false,
          error: "Operación bloqueada por seguridad: Está estrictamente prohibido facturar a Público General (XAXX010101000). Los tickets son reales y deben facturarse únicamente a nombre del titular.",
        });
      }

      // Verify all items belong to an active station
      const stationsPath = path.resolve(
        process.cwd(),
        "config",
        "supported_stations.json",
      );
      let activeStationDescriptors: any[] = [];
      if (fs.existsSync(stationsPath)) {
        try {
          const allStations = JSON.parse(
            fs.readFileSync(stationsPath, "utf-8"),
          );
          activeStationDescriptors = allStations.filter(
            (s: any) => s.status === "active",
          );
        } catch {}
      }
      if (activeStationDescriptors.length === 0) {
        activeStationDescriptors = [
          { id: "gogas", domain: "facturasgas.com", status: "active" },
          {
            id: "lodemo",
            domain: "lodemored.com.mx",
            portalUrl: "https://fact.lodemored.net/",
            status: "active",
          },
          {
            id: "controlgas",
            domain: "litroscompletos.mx",
            portalUrl: "https://www.litroscompletos.mx",
            status: "active",
          },
        ];
      }

      for (const item of jobsToQueue) {
        const url = (item.receiptData.billingUrl || "").toLowerCase();
        const station = (item.receiptData.gasStation || "").toLowerCase();
        const isActive = activeStationDescriptors.some((st: any) => {
          const stDomain = (st.domain || "").toLowerCase();
          const stPortal = (st.portalUrl || "").toLowerCase();
          const stId = (st.id || "").toLowerCase();
          const stName = (st.name || "").toLowerCase();
          return (
            (stDomain && url.includes(stDomain)) ||
            (stPortal && url === stPortal) ||
            (stId && station === stId) ||
            (stName && station === stName) ||
            (st.id === "gogas" &&
              (url.includes("facturasgas") ||
                station.includes("gogas") ||
                station.includes("facturasgas") ||
                station.includes("lagas"))) ||
            (st.id === "lodemo" &&
              (url.includes("lodemo") ||
                url.includes("lodemored") ||
                station.includes("lodemo") ||
                station.includes("zazil") ||
                station.includes("inmobiliaria del zazil ha"))) ||
            (st.id === "controlgas" &&
              (url.includes("litroscompletos") ||
                url.includes("controlgas") ||
                url.includes("ccae04778") ||
                station.includes("combustibles de cancun") ||
                station.includes("litroscompletos") ||
                station.includes("controlgas") ||
                station.includes("sandoval")))
          );
        });

        if (!isActive) {
          return res.status(400).json({
            success: false,
            unavailableStation: true,
            stationName: item.receiptData.gasStation || "Esta gasolinera",
            error: `La gasolinera "${item.receiptData.gasStation || "seleccionada"}" aún no está disponible para facturación automática.`,
          });
        }
      }

      // Verify duplicate tracking number against existing history.
      // Entries with status 'scanned' or 'failed' must NOT block invoicing.
      const existingHistory = await RedisHistoryService.getHistoryByRfc(
        billingProfile.rfc,
      );
      const registeredTickets = new Set(
        existingHistory
          .filter((h) => h.status !== "scanned" && h.status !== "failed")
          .map((h) => (h.trackingNumber || "").trim().toUpperCase())
          .filter((t) => t.length > 0),
      );

      const duplicates = jobsToQueue
        .map((j) => (j.receiptData.trackingNumber || "").trim())
        .filter(
          (trk) => trk.length > 0 && registeredTickets.has(trk.toUpperCase()),
        );

      const seenQueueHashes = new Set<string>();
      const duplicateHashes: string[] = [];
      for (const item of jobsToQueue) {
        const fileHash = item.receiptData.fileHash;
        const itemRfc = (item.billingProfile.rfc || "").trim().toUpperCase();
        if (!fileHash) continue;
        if (seenQueueHashes.has(fileHash)) {
          duplicateHashes.push(fileHash);
        } else if (
          itemRfc &&
          itemRfc !== "TEMP" &&
          (await ReceiptMetadataService.isDuplicateHash(
            itemRfc,
            fileHash,
            {
              excludeBaseName: item.receiptData.receiptBaseName,
            },
          ))
        ) {
          duplicateHashes.push(fileHash);
        }
        seenQueueHashes.add(fileHash);
      }

      if (duplicateHashes.length > 0) {
        return res.status(409).json({
          success: false,
          error:
            "Ya tienes este recibo registrado en tu historial. No es posible reenviarlo.",
          duplicateHashes,
        });
      }

      if (duplicates.length > 0) {
        return res.status(409).json({
          success: false,
          error: `El ticket "${duplicates.join(", ")}" ya se encuentra registrado en tu historial. No se permite reenviarlo.`,
          duplicateTickets: duplicates,
        });
      }

      const enqueuedJobs = [];
      for (const item of jobsToQueue) {
        const itemRfc = ReceiptMetadataService.sanitizeRfc(item.billingProfile.rfc);
        const baseName = item.receiptData.receiptBaseName || `receipt_${Date.now()}_0`;
        const fileHash = item.receiptData.fileHash || "";

        // Promote temporary staging image to permanent RFC receipts storage on enqueue
        const currentImgUrl =
          normalizePublicMediaUrl(
            item.receiptData.receiptImageUrl || item.receiptData.previewUrl,
          ) || "";
        let finalImageUrl = currentImgUrl;
        let savedFileName = item.receiptData.imageFileName || "";

        if (
          currentImgUrl.includes("/output/TEMP/staging/") ||
          currentImgUrl.includes("/output/TEMP/receipts/") ||
          currentImgUrl.startsWith("/output/TEMP/")
        ) {
          const tempFileName = path.basename(currentImgUrl);
          const ext = path.extname(tempFileName) || ".png";
          savedFileName = `${baseName}${ext}`;

          const localRfcReceiptsDir = path.resolve(
            ENV.SCREENSHOT_DIR,
            itemRfc,
            "receipts",
          );
          if (!fs.existsSync(localRfcReceiptsDir)) {
            fs.mkdirSync(localRfcReceiptsDir, { recursive: true });
          }
          const permLocalPath = path.join(localRfcReceiptsDir, savedFileName);

          const stagingSource = path.resolve(
            ENV.SCREENSHOT_DIR,
            "TEMP",
            "staging",
            tempFileName,
          );
          const legacyTempSource = path.resolve(
            ENV.SCREENSHOT_DIR,
            "TEMP",
            "receipts",
            tempFileName,
          );
          const sourcePath = fs.existsSync(stagingSource)
            ? stagingSource
            : fs.existsSync(legacyTempSource)
              ? legacyTempSource
              : null;

          if (sourcePath && fs.existsSync(sourcePath)) {
            try {
              const buffer = fs.readFileSync(sourcePath);
              fs.writeFileSync(permLocalPath, buffer);
              finalImageUrl = `/output/${itemRfc}/receipts/${savedFileName}`;

              // Upload to permanent storage (MinIO / S3 / Local)
              const storageKey = `${itemRfc}/receipts/${savedFileName}`;
              try {
                const uploadResult = await storageService.upload(
                  storageKey,
                  buffer,
                  {
                    contentType:
                      ext.includes("jpg") || ext.includes("jpeg")
                        ? "image/jpeg"
                        : "image/png",
                  },
                );
                if (uploadResult?.url) {
                  finalImageUrl =
                    normalizePublicMediaUrl(uploadResult.url) || finalImageUrl;
                }
              } catch (storageErr: any) {
                console.warn(
                  `[Server] Storage upload failed for key "${storageKey}":`,
                  storageErr.message,
                );
              }
            } catch (copyErr: any) {
              console.warn(
                "[Server] Could not promote staging image to RFC storage:",
                copyErr.message,
              );
            }
          }
        }

        item.receiptData.receiptImageUrl = finalImageUrl;
        item.receiptData.imageFileName = savedFileName;
        item.receiptData.receiptBaseName = baseName;

        // Clear any previous deletion tombstones for this tracking number or hash so the new submission is accepted
        await RedisHistoryService.untombstoneEntry(itemRfc, {
          fileHash,
          trackingNumber: item.receiptData.trackingNumber,
          id: baseName,
        });

        // Persist definitive JSON metadata with enqueued status now that user confirmed
        try {
          const metadataRecord =
            await ReceiptMetadataService.saveScannedMetadata({
              rfc: itemRfc,
              baseName,
              fileHash,
              originalFilename: savedFileName || `${baseName}.png`,
              imageFileName: savedFileName || `${baseName}.png`,
              receiptImageUrl: finalImageUrl,
              parsed: item.receiptData,
              status: "waiting",
            });
          item.receiptData.receiptJsonUrl =
            normalizePublicMediaUrl(metadataRecord.jsonUrl) ||
            metadataRecord.jsonUrl;
        } catch (metaErr: any) {
          console.warn(
            "[Server] Could not save permanent metadata record:",
            metaErr.message,
          );
        }

        const job = await addInvoiceJob({
          receiptData: item.receiptData,
          billingProfile: item.billingProfile,
          recordVideo:
            recordVideo === undefined ? ENV.RECORD_VIDEO : recordVideo,
          dryRun: dryRun === undefined ? ENV.DRY_RUN : dryRun,
          takeScreenshot:
            takeScreenshot === undefined ? ENV.TAKE_SCREENSHOT : takeScreenshot,
        });

        // Store immediately in Redis under the user's RFC so any device can see it in real-time
        await RedisHistoryService.upsertEntry({
          id: `hist_${job.id}`,
          jobId: job.id,
          rfc: item.billingProfile.rfc,
          razonSocial: item.billingProfile.razonSocial,
          trackingNumber: item.receiptData.trackingNumber,
          gasStation: item.receiptData.gasStation,
          stationNumber: item.receiptData.stationNumber,
          cashier: item.receiptData.cashier,
          address: item.receiptData.address,
          paymentMethod: item.receiptData.paymentMethod,
          liters: item.receiptData.liters,
          billingUrl: item.receiptData.billingUrl,
          amount: item.receiptData.amount,
          date: item.receiptData.date || new Date().toISOString().split("T")[0],
          timestamp: new Date().toISOString(),
          status: "waiting",
          progress: 10,
          submitted: false,
          receiptImageUrl: finalImageUrl,
          fileHash: item.receiptData.fileHash,
          receiptJsonUrl: item.receiptData.receiptJsonUrl,
          message: "Esperando turno en cola...",
        });

        await ReceiptMetadataService.updateOnEnqueue({
          rfc: item.billingProfile.rfc,
          jobId: job.id || `pending_${Date.now()}`,
          receiptData: item.receiptData,
          billingProfile: item.billingProfile,
        });

        enqueuedJobs.push({
          jobId: job.id,
          trackingNumber: item.receiptData.trackingNumber,
          gasStation: item.receiptData.gasStation,
          amount: item.receiptData.amount,
        });
      }

      res.json({
        success: true,
        message: `${enqueuedJobs.length} proceso(s) encolado(s) exitosamente`,
        jobs: enqueuedJobs,
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Get job status from BullMQ
  app.get("/api/queue/jobs/:jobId", async (req: Request, res: Response) => {
    try {
      const jobId = String(req.params.jobId || "");
      const queue = getInvoiceQueue();
      const job = await queue.getJob(jobId);

      if (!job) {
        return res.status(404).json({
          success: false,
          error: `Proceso con ID #${jobId} no encontrado en la cola.`,
        });
      }

      const rawState = await job.getState();
      const progress = job.progress;

      const rawRfc = (job.data?.billingProfile?.rfc || "GENERAL")
        .toString()
        .trim()
        .toUpperCase();
      const rfcFolder = rawRfc.replace(/[^A-Z0-9&Ñ]/g, "") || "GENERAL";

      let screenshotUrl = normalizePublicMediaUrl(job.returnvalue?.screenshotUrl);
      let videoUrl = normalizePublicMediaUrl(job.returnvalue?.videoUrl);
      let pdfUrl = normalizePublicMediaUrl(job.returnvalue?.pdfUrl);

      if (!screenshotUrl && job.returnvalue?.screenshotPath) {
        const filename = job.returnvalue.screenshotPath.split("/").pop();
        screenshotUrl = `/output/${rfcFolder}/screenshots/${filename}`;
      }

      if (!videoUrl && job.returnvalue?.videoPath) {
        const filename = job.returnvalue.videoPath.split("/").pop();
        videoUrl = `/output/${rfcFolder}/videos/${filename}`;
      }

      if (!pdfUrl && job.returnvalue?.pdfPath) {
        const filename = job.returnvalue.pdfPath.split("/").pop();
        pdfUrl = `/output/${rfcFolder}/invoices/${filename}`;
      }

      let state: string = rawState;
      let failedReason: string | null = job.failedReason || null;
      if (rawState === "completed" && job.returnvalue) {
        const retMsg = job.returnvalue.message || "";
        const isRejected =
          !job.returnvalue.success ||
          (!job.returnvalue.submitted && !job.data?.dryRun) ||
          REJECTION_MESSAGE_REGEX.test(retMsg);
        if (isRejected) {
          state = "failed";
          failedReason =
            retMsg || failedReason || "La facturación fue rechazada por el portal.";
        }
      }

      res.json({
        success: true,
        jobId: job.id,
        state,
        progress,
        data: {
          trackingNumber: job.data.receiptData.trackingNumber,
          gasStation: job.data.receiptData.gasStation,
          amount: job.data.receiptData.amount,
          rfc: job.data.billingProfile.rfc,
          razonSocial: job.data.billingProfile.razonSocial,
        },
        result: job.returnvalue
          ? {
              ...job.returnvalue,
              screenshotUrl,
              videoUrl,
              pdfUrl,
              xmlUrl: normalizePublicMediaUrl(job.returnvalue.xmlUrl),
            }
          : null,
        failedReason,
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  function sanitizeAndNormalizeHistoryItems(items: any[]) {
    for (const item of items) {
      item.receiptImageUrl =
        normalizePublicMediaUrl(item.receiptImageUrl) || item.receiptImageUrl;
      if (item.previewUrl) {
        item.previewUrl =
          normalizePublicMediaUrl(item.previewUrl) || item.previewUrl;
      }
      if (item.imageUrl) {
        item.imageUrl =
          normalizePublicMediaUrl(item.imageUrl) || item.imageUrl;
      }
      item.screenshotUrl =
        normalizePublicMediaUrl(item.screenshotUrl) || item.screenshotUrl;
      item.videoUrl = normalizePublicMediaUrl(item.videoUrl) || item.videoUrl;
      item.pdfUrl = normalizePublicMediaUrl(item.pdfUrl) || item.pdfUrl;
      item.receiptJsonUrl =
        normalizePublicMediaUrl(item.receiptJsonUrl) || item.receiptJsonUrl;

      if (item.status === "waiting" || item.status === "active") {
        continue;
      }
      const msg = item.message || "";
      const err = item.error || "";
      const hasRejectionOrError = Boolean(
        err ||
          (msg && REJECTION_MESSAGE_REGEX.test(msg)) ||
          (item.status === "completed" &&
            !item.submitted &&
            !item.pdfUrl &&
            !/simulaci[oó]n/i.test(msg) &&
            !POSITIVE_SUCCESS_MESSAGE_REGEX.test(msg)),
      );
      if (hasRejectionOrError && item.status !== "failed") {
        item.status = "failed";
        item.submitted = false;
        if (!item.error) {
          item.error =
            item.message || "La facturación fue rechazada por el portal.";
        }
      }
    }
  }

  function parseFlexibleDate(dateStr?: string): Date | null {
    if (!dateStr) return null;
    const str = dateStr.trim();
    const dmyMatch = str.match(
      /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/
    );
    if (dmyMatch) {
      const day = parseInt(dmyMatch[1], 10);
      const month = parseInt(dmyMatch[2], 10) - 1;
      const year = parseInt(dmyMatch[3], 10);
      const hour = dmyMatch[4] ? parseInt(dmyMatch[4], 10) : 12;
      const min = dmyMatch[5] ? parseInt(dmyMatch[5], 10) : 0;
      const sec = dmyMatch[6] ? parseInt(dmyMatch[6], 10) : 0;
      const d = new Date(year, month, day, hour, min, sec);
      if (!isNaN(d.getTime())) return d;
    }
    const parsed = new Date(str);
    return isNaN(parsed.getTime()) ? null : parsed;
  }

  // List transactions with pagination, date-range filtering, and aggregated analytics
  app.get("/api/transactions", async (req: Request, res: Response) => {
    try {
      const rawRfc = (req.query.rfc || "").toString().trim().toUpperCase();
      if (!rawRfc) {
        return res
          .status(400)
          .json({ success: false, error: "RFC es requerido." });
      }
      const rfc = ReceiptMetadataService.sanitizeRfc(rawRfc);

      // 1. Storage is Single Source of Truth: ensure Redis read-model is reconciled
      await ReceiptMetadataService.rehydrateRedisIndex(rfc);
      let history = await RedisHistoryService.getHistoryByRfc(rfc);
      sanitizeAndNormalizeHistoryItems(history);
      history = RedisHistoryService.deduplicateList(history);

      // 3. Filter by date range if provided
      let filtered = [...history];
      const days = req.query.days
        ? parseInt(req.query.days as string, 10)
        : undefined;
      const fromParam = req.query.from as string;
      const toParam = req.query.to as string;

      if (days && !isNaN(days) && days > 0) {
        const now = Date.now();
        const cutoff = now - days * 24 * 60 * 60 * 1000;
        filtered = filtered.filter((item) => {
          const itemDate =
            parseFlexibleDate(item.date) ||
            parseFlexibleDate(item.timestamp);
          const itemTime = itemDate ? itemDate.getTime() : NaN;
          return !isNaN(itemTime) && itemTime >= cutoff;
        });
      } else if (fromParam || toParam) {
        if (fromParam) {
          const fromTime = new Date(`${fromParam}T00:00:00`).getTime();
          filtered = filtered.filter((item) => {
            const itemDate =
              parseFlexibleDate(item.date) ||
              parseFlexibleDate(item.timestamp);
            const itemTime = itemDate ? itemDate.getTime() : NaN;
            return !isNaN(itemTime) && itemTime >= fromTime;
          });
        }
        if (toParam) {
          const toTime = new Date(`${toParam}T23:59:59`).getTime();
          filtered = filtered.filter((item) => {
            const itemDate =
              parseFlexibleDate(item.date) ||
              parseFlexibleDate(item.timestamp);
            const itemTime = itemDate ? itemDate.getTime() : NaN;
            return !isNaN(itemTime) && itemTime <= toTime;
          });
        }
      }

      // 4. Sort: latest first (newest at the top, oldest at the bottom)
      filtered.sort((a, b) => {
        const timeA =
          (parseFlexibleDate(a.date) || parseFlexibleDate(a.timestamp))?.getTime() || 0;
        const timeB =
          (parseFlexibleDate(b.date) || parseFlexibleDate(b.timestamp))?.getTime() || 0;
        return timeB - timeA;
      });

      // 5. Compute Trends & Analytics Summary
      let totalAmount = 0;
      let totalLiters = 0;
      const byGasStation: Record<
        string,
        { count: number; amount: number; liters: number }
      > = {};
      const byPaymentMethod: Record<string, { count: number; amount: number }> =
        {};
      const byDateMap: Record<
        string,
        { date: string; amount: number; liters: number; count: number }
      > = {};

      for (const item of filtered) {
        const amt = Number(item.amount) || 0;
        const lit =
          Number(item.liters) ||
          (amt > 0 ? Number((amt / 24.5).toFixed(2)) : 0);
        totalAmount += amt;
        totalLiters += lit;

        // Gas Station aggregation
        const station = (item.gasStation || "Otras").trim().toUpperCase();
        if (!byGasStation[station]) {
          byGasStation[station] = { count: 0, amount: 0, liters: 0 };
        }
        byGasStation[station].count++;
        byGasStation[station].amount += amt;
        byGasStation[station].liters += lit;

        // Payment Method aggregation
        const method = (item.paymentMethod || "No especificado")
          .trim()
          .toUpperCase();
        if (!byPaymentMethod[method]) {
          byPaymentMethod[method] = { count: 0, amount: 0 };
        }
        byPaymentMethod[method].count++;
        byPaymentMethod[method].amount += amt;

        // Date timeline aggregation
        const dObj =
          parseFlexibleDate(item.date) || parseFlexibleDate(item.timestamp);
        const dStr = dObj
          ? `${dObj.getFullYear()}-${String(dObj.getMonth() + 1).padStart(2, "0")}-${String(dObj.getDate()).padStart(2, "0")}`
          : (item.date || item.timestamp || "").split("T")[0] || "Desconocida";

        if (!byDateMap[dStr]) {
          byDateMap[dStr] = { date: dStr, amount: 0, liters: 0, count: 0 };
        }
        byDateMap[dStr].amount += amt;
        byDateMap[dStr].liters += lit;
        byDateMap[dStr].count++;
      }

      // Sort timeline chronologically
      const timeline = Object.values(byDateMap).sort((a, b) =>
        a.date.localeCompare(b.date),
      );

      // 6. Pagination (max 50 items per page)
      const page = Math.max(
        1,
        parseInt((req.query.page as string) || "1", 10),
      );
      const limit = Math.min(
        50,
        Math.max(1, parseInt((req.query.limit as string) || "50", 10)),
      );
      const total = filtered.length;
      const totalPages = Math.ceil(total / limit) || 1;
      const startIndex = (page - 1) * limit;
      const paginatedItems = filtered.slice(startIndex, startIndex + limit);

      return res.json({
        success: true,
        transactions: paginatedItems,
        pagination: {
          page,
          limit,
          total,
          totalPages,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1,
        },
        summary: {
          totalAmount: Number(totalAmount.toFixed(2)),
          totalLiters: Number(totalLiters.toFixed(2)),
          count: total,
          averageTicket:
            total > 0 ? Number((totalAmount / total).toFixed(2)) : 0,
          byGasStation,
          byPaymentMethod,
          timeline,
        },
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // Automation history for a given RFC (from Redis, including real-time active/waiting jobs)
  app.get("/api/history/:rfc", async (req: Request, res: Response) => {
    try {
      const rfc = String(req.params.rfc || "")
        .trim()
        .toUpperCase();
      if (!rfc) {
        return res
          .status(400)
          .json({ success: false, error: "RFC es requerido." });
      }

      // Storage is Single Source of Truth: ensure Redis read-model is reconciled
      await ReceiptMetadataService.rehydrateRedisIndex(rfc);
      let history = await RedisHistoryService.getHistoryByRfc(rfc);

      // Sync active/waiting jobs with real-time BullMQ progress
      const queue = getInvoiceQueue();
      for (const item of history) {
        if (
          (item.status === "waiting" || item.status === "active") &&
          item.jobId
        ) {
          try {
            const bJob = await queue.getJob(item.jobId);
            if (bJob) {
              const state = await bJob.getState();
              if (typeof bJob.progress === "number") {
                item.progress = bJob.progress;
              }
              if (state === "active") {
                item.status = "active";
                if (
                  !item.message ||
                  item.message === "Esperando turno en cola..."
                ) {
                  item.message = "Navegando y facturando en portal...";
                }
              } else if (state === "completed") {
                const jobRet = bJob.returnvalue;
                const retMsg = jobRet?.message || "";
                const hasRetRejection = Boolean(
                  retMsg && REJECTION_MESSAGE_REGEX.test(retMsg),
                );
                const isActuallySuccess = jobRet
                  ? Boolean(
                      jobRet.success &&
                        !hasRetRejection &&
                        (jobRet.submitted || bJob.data?.dryRun),
                    )
                  : !item.error;

                item.status = isActuallySuccess
                  ? (bJob.data?.dryRun ? "dry_run" : "completed")
                  : "failed";
                item.progress = 100;
                item.submitted = Boolean(jobRet?.submitted || (isActuallySuccess && !bJob.data?.dryRun));
                if (jobRet?.message) {
                  item.message = jobRet.message;
                }
                if (!isActuallySuccess) {
                  item.error = jobRet?.message || item.message || "La facturación fue rechazada por el portal.";
                }
                const jobRfc = (
                  bJob.data?.billingProfile?.rfc ||
                  rfc ||
                  "GENERAL"
                )
                  .toString()
                  .trim()
                  .toUpperCase();
                const jobRfcFolder =
                  jobRfc.replace(/[^A-Z0-9&Ñ]/g, "") || "GENERAL";

                if (bJob.returnvalue?.screenshotUrl) {
                  item.screenshotUrl = normalizePublicMediaUrl(
                    bJob.returnvalue.screenshotUrl,
                  );
                } else if (bJob.returnvalue?.screenshotPath) {
                  const fn = bJob.returnvalue.screenshotPath.split("/").pop();
                  item.screenshotUrl = `/output/${jobRfcFolder}/screenshots/${fn}`;
                }

                if (bJob.returnvalue?.videoUrl) {
                  item.videoUrl = normalizePublicMediaUrl(
                    bJob.returnvalue.videoUrl,
                  );
                } else if (bJob.returnvalue?.videoPath) {
                  const fn = bJob.returnvalue.videoPath.split("/").pop();
                  item.videoUrl = `/output/${jobRfcFolder}/videos/${fn}`;
                }

                if (bJob.returnvalue?.pdfUrl) {
                  item.pdfUrl = normalizePublicMediaUrl(
                    bJob.returnvalue.pdfUrl,
                  );
                } else if (bJob.returnvalue?.pdfPath) {
                  const fn = bJob.returnvalue.pdfPath.split("/").pop();
                  item.pdfUrl = `/output/${jobRfcFolder}/invoices/${fn}`;
                }
              } else if (state === "failed") {
                item.status = "failed";
                item.progress = 100;
                item.error = bJob.failedReason || item.error;
              }
            }
          } catch (syncErr: any) {
            console.warn(
              "[History] Could not sync BullMQ job state:",
              syncErr.message,
            );
          }
        }
      }

      // Sanitize status and normalize any legacy internal MinIO URLs
      sanitizeAndNormalizeHistoryItems(history);

      const cleanHistory = RedisHistoryService.deduplicateList(history);
      sanitizeAndNormalizeHistoryItems(cleanHistory);

      res.json({
        success: true,
        rfc,
        count: cleanHistory.length,
        history: cleanHistory,
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Delete history entry or cancel in-progress job
  app.delete("/api/history/:id", async (req: Request, res: Response) => {
    try {
      const id = String(req.params.id || "");
      const rfc = String(req.query.rfc || req.body?.rfc || "")
        .trim()
        .toUpperCase();
      if (!rfc) {
        return res.status(400).json({
          success: false,
          error: "RFC es requerido para eliminar del historial.",
        });
      }

      const history = await RedisHistoryService.getHistoryByRfc(rfc);
      const entry = history.find(
        (h) =>
          h.id === id ||
          h.jobId === id ||
          `hist_${h.jobId}` === id ||
          h.trackingNumber === id,
      );

      if (!entry) {
        return res.status(404).json({
          success: false,
          error: "Entrada de historial no encontrada.",
        });
      }

      const targetJobId = entry.jobId || id;
      await RedisHistoryService.tombstoneEntry(rfc, {
        ...entry,
        id,
        jobId: targetJobId,
      });

      // If there's an associated BullMQ job in queue/processing, remove/cancel it.
      // Locked active jobs may not be removable; Redis tombstones above prevent later rewrites.
      if (targetJobId) {
        try {
          const queue = getInvoiceQueue();
          const job = await queue.getJob(targetJobId);
          if (job) {
            await job.remove();
            console.log(
              `[Queue] Removed/cancelled job ${targetJobId} on user deletion.`,
            );
          }
        } catch (queueErr: any) {
          console.warn(
            `[Queue] Could not remove job ${targetJobId}:`,
            queueErr.message,
          );
        }
      }

      // Attempt to delete physical artifacts (image + JSON from disk and storage).
      // Errors here are non-fatal for the tombstone + hash cleanup that follows.
      let artifactDeletion: { deletedKeys: string[]; missing: boolean } = {
        deletedKeys: [],
        missing: true,
      };
      try {
        artifactDeletion = await ReceiptMetadataService.deleteReceiptArtifacts({
          rfc,
          entry: {
            ...entry,
            id,
            jobId: targetJobId,
          },
        });
      } catch (deleteErr: any) {
        console.warn(
          `[History] deleteReceiptArtifacts failed for entry "${id}":`,
          deleteErr.message,
        );
        // Non-fatal — continue with hash cleanup and Redis entry removal.
      }

      // Always unregister the file hash from Redis so the same file can be
      // re-uploaded after deletion without a false-positive duplicate error.
      const fileHashToRemove = entry.fileHash;
      if (fileHashToRemove) {
        await RedisHistoryService.unregisterFileHash(rfc, fileHashToRemove);
        // Also tombstone by hash so isDuplicateHash short-circuits correctly
        await RedisHistoryService.tombstoneEntry(rfc, {
          fileHash: fileHashToRemove,
        });
      }

      const deleted = await RedisHistoryService.deleteEntry(rfc, id);
      return res.json({
        success: Boolean(deleted),
        artifactsDeleted: artifactDeletion.deletedKeys,
        artifactsMissing: artifactDeletion.missing,
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // Retry / re-enqueue failed invoice
  app.post("/api/history/:id/retry", async (req: Request, res: Response) => {
    try {
      const id = String(req.params.id || "");
      const rfc = String(req.body?.rfc || req.query.rfc || "")
        .trim()
        .toUpperCase();
      if (!rfc) {
        return res.status(400).json({
          success: false,
          error: "RFC es requerido para reenviar el ticket.",
        });
      }

      const history = await RedisHistoryService.getHistoryByRfc(rfc);
      const entry = history.find(
        (h) =>
          h.id === id ||
          h.jobId === id ||
          `hist_${h.jobId}` === id ||
          h.trackingNumber === id,
      );

      if (!entry) {
        return res.status(404).json({
          success: false,
          error: "Entrada de historial no encontrada.",
        });
      }

      // Reconstruct billingProfile from body or local config
      let billingProfile = req.body?.billingProfile;
      if (!billingProfile || !billingProfile.rfc) {
        const configPath = path.resolve(
          process.cwd(),
          "config",
          "billing_profile.json",
        );
        if (fs.existsSync(configPath)) {
          try {
            billingProfile = JSON.parse(fs.readFileSync(configPath, "utf-8"));
          } catch {}
        }
      }
      if (!billingProfile || !billingProfile.rfc) {
        billingProfile = {
          rfc,
          razonSocial: entry.razonSocial || "",
          regimenFiscal: "601",
          codigoPostal: "77500",
          usoCfdi: "G03",
          formaPago: "04",
        };
      }

      // Look up full ticket metadata from disk if available
      const localDir = ReceiptMetadataService.getLocalReceiptsDir(rfc);
      let rawTicketData: Partial<ParsedReceiptData> | null = null;
      let recordRawText = "";
      let recordFileHash: string | undefined;
      let recordId: string | undefined;
      let recordImageUrl: string | undefined;
      let recordImageFileName: string | undefined;
      let recordJsonUrl: string | undefined;

      const candidateBaseName =
        entry.receiptBaseName ||
        (entry.id && entry.id.startsWith("receipt_") ? entry.id : undefined);
      if (candidateBaseName || entry.jsonFileName) {
        const jsonFile = entry.jsonFileName || `${candidateBaseName}.json`;
        const fullPath = path.join(localDir, jsonFile);
        if (fs.existsSync(fullPath)) {
          try {
            const record = JSON.parse(fs.readFileSync(fullPath, "utf-8"));
            if (record.ticket) {
              rawTicketData = record.ticket;
            }
            recordRawText = record.rawText || record.ticket?.rawText || "";
            recordFileHash = record.fileHash;
            recordId = record.id;
            recordImageUrl = record.imageUrl;
            recordImageFileName = record.imageFileName;
            recordJsonUrl = record.jsonUrl;
          } catch {}
        }
      }

      const receiptData: ParsedReceiptData = {
        gasStation: rawTicketData?.gasStation || entry.gasStation || "GOGAS",
        stationNumber: rawTicketData?.stationNumber || entry.stationNumber,
        address: rawTicketData?.address || entry.address,
        cashier: rawTicketData?.cashier || entry.cashier,
        trackingNumber:
          rawTicketData?.trackingNumber || entry.trackingNumber || "",
        transaction: rawTicketData?.transaction,
        webId: rawTicketData?.webId,
        folio: rawTicketData?.folio,
        amount: rawTicketData?.amount ?? entry.amount ?? 0,
        liters: rawTicketData?.liters ?? entry.liters,
        subtotal: rawTicketData?.subtotal,
        iva: rawTicketData?.iva,
        date: rawTicketData?.date || entry.date || new Date().toISOString(),
        paymentMethod:
          rawTicketData?.paymentMethod || entry.paymentMethod || "TARJETA",
        billingUrl:
          rawTicketData?.billingUrl ||
          entry.billingUrl ||
          "https://facturasgas.com",
        rawText: recordRawText || rawTicketData?.rawText || "",
        fileHash: entry.fileHash || recordFileHash,
        receiptBaseName: entry.receiptBaseName || recordId,
        receiptImageUrl: normalizePublicMediaUrl(
          entry.receiptImageUrl || recordImageUrl,
        ),
        imageFileName: entry.imageFileName || recordImageFileName,
        receiptJsonUrl: normalizePublicMediaUrl(
          entry.receiptJsonUrl || recordJsonUrl,
        ),
      };

      // Reconcile station and tracking number prefix if station is known or matches a known GoGas 5-digit station (e.g. 14704 -> 14764)
      const textCtx = `${receiptData.address || ""} ${receiptData.rawText || ""}`;
      if (/BUQUE\s*DE\s*VELA|BVE190821/i.test(textCtx)) {
        receiptData.stationNumber = "14764";
      } else if (/DELFINES|SDE070824/i.test(textCtx)) {
        receiptData.stationNumber = "10549";
      } else if (/AN[EÉ]MONAS|SSA120627/i.test(textCtx)) {
        receiptData.stationNumber = "12009";
      } else if (/KABAH/i.test(textCtx)) {
        receiptData.stationNumber = "11001";
      }

      if (receiptData.trackingNumber && receiptData.trackingNumber.length >= 14) {
        const KNOWN_GOGAS_5DIGIT = ["14764", "12009", "11001", "10549"];
        let targetStationDigits = (receiptData.stationNumber || "").replace(
          /\D/g,
          "",
        );
        const prefix5 = receiptData.trackingNumber.slice(0, 5);
        if (!targetStationDigits || !KNOWN_GOGAS_5DIGIT.includes(targetStationDigits)) {
          for (const st of KNOWN_GOGAS_5DIGIT) {
            let dist = 0;
            for (let i = 0; i < 5; i++) {
              if (prefix5[i] !== st[i]) dist++;
            }
            if (dist <= 2) {
              targetStationDigits = st;
              receiptData.stationNumber = st;
              break;
            }
          }
        }
        if (
          targetStationDigits.length >= 4 &&
          !receiptData.trackingNumber.startsWith(targetStationDigits)
        ) {
          const prefix = receiptData.trackingNumber.slice(
            0,
            targetStationDigits.length,
          );
          if (prefix.length === targetStationDigits.length) {
            let diffCount = 0;
            for (let i = 0; i < targetStationDigits.length; i++) {
              if (prefix[i] !== targetStationDigits[i]) diffCount++;
            }
            if (diffCount <= 2) {
              receiptData.trackingNumber =
                targetStationDigits +
                receiptData.trackingNumber.slice(targetStationDigits.length);
            }
          }
        }
      }

      const newJob = await addInvoiceJob({
        receiptData,
        billingProfile,
        recordVideo: req.body?.recordVideo ?? false,
        dryRun: req.body?.dryRun ?? false,
        takeScreenshot: req.body?.takeScreenshot ?? true,
      });

      // Update Redis entry with new job ID and reset status to waiting
      await RedisHistoryService.upsertEntry({
        ...entry,
        id: entry.id,
        jobId: String(newJob.id),
        trackingNumber: receiptData.trackingNumber,
        status: "waiting",
        progress: 15,
        submitted: false,
        message: "Esperando turno en cola para facturación...",
        error: undefined,
        timestamp: new Date().toISOString(),
      });

      return res.json({
        success: true,
        jobId: String(newJob.id),
        trackingNumber: receiptData.trackingNumber,
        message: `Ticket #${receiptData.trackingNumber} reenviado a la cola con éxito.`,
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // Download Invoice PDF
  app.get("/api/invoices/:id/pdf", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const ticket = String(req.query.ticket || id);

      // Check local storage / output directory first
      const outputDir = path.resolve(ENV.SCREENSHOT_DIR);
      if (fs.existsSync(outputDir)) {
        const files = fs
          .readdirSync(outputDir)
          .filter((f) => f.includes(ticket) && f.endsWith(".pdf"));
        if (files.length > 0) {
          const filePath = path.join(outputDir, files[0]);
          return res.download(filePath, `factura_${ticket}.pdf`);
        }
      }

      // Check in configured storage service (e.g. S3 / MinIO)
      const storageKey = `invoices/factura_${ticket}.pdf`;
      const existsInStorage = await storageService.exists(storageKey);
      if (existsInStorage) {
        const pdfBuffer = await storageService.download(storageKey);
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="factura_${ticket}.pdf"`,
        );
        return res.send(pdfBuffer);
      }

      return res.status(404).json({
        success: false,
        error: "Comprobante PDF no disponible aún para este ticket.",
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  return {
    app,
    worker,
    start: () =>
      new Promise<void>((resolve) => {
        const host = options.host || ENV.HOST || "0.0.0.0";
        app.listen(port, host, () => {
          console.log(
            `[GasInvoice HTTP API] Server running on http://${host}:${port}`,
          );
          console.log(
            `[GasInvoice HTTP API] Redis connection: ${ENV.REDIS_URL}`,
          );
          resolve();
        });
      }),
  };
}

if (
  process.argv[1]?.endsWith("http/server.ts") ||
  process.argv[1]?.endsWith("http/server.js")
) {
  createHttpServer(ENV.PORT)
    .then((s) => s.start())
    .catch((err) => {
      console.error("[GasInvoice HTTP API] Fatal error:", err);
      process.exit(1);
    });
}
