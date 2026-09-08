import express, { Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { ENV } from '../../config/env.js';
import { GasInvoiceService } from '../../services/gasInvoiceService.js';
import { BillingProfile, ParsedReceiptData } from '../../core/types.js';
import { getInvoiceQueue, addInvoiceJob } from '../../infrastructure/queue/invoiceQueue.js';
import { startInvoiceWorker } from '../../infrastructure/queue/invoiceWorker.js';
import { RedisHistoryService } from '../../infrastructure/storage/redisHistory.js';
import {
  RegimenesFiscalesCatalog,
  UsosCfdiCatalog,
  FormasPagoCatalog,
} from '../../../config/catalogs/index.js';
import { StorageFactory } from '../../infrastructure/storage/storageFactory.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB per file
});

export async function createHttpServer(
  port: number = ENV.PORT,
  options: { enableWorker?: boolean; host?: string } = {}
) {
  const app = express();

  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));

  // Serve static assets: Web Application, screenshots, videos, and fixtures
  app.use(express.static(path.resolve(process.cwd(), 'public')));
  app.use('/output', express.static(ENV.SCREENSHOT_DIR));
  app.use('/output/videos', express.static(ENV.VIDEO_DIR));
  app.use('/fixtures', express.static(path.resolve(process.cwd(), 'fixtures')));

  const storageService = StorageFactory.getStorageService();
  const service = await GasInvoiceService.createDefault({
    storageService,
  });

  // Start background BullMQ worker if enabled (disabled in dedicated web / api mode)
  const shouldStartWorker =
    options.enableWorker !== undefined
      ? options.enableWorker
      : ENV.APP_MODE === 'all' || ENV.APP_MODE === 'worker';

  const worker = shouldStartWorker ? startInvoiceWorker() : null;
  if (worker) {
    console.log('[GasInvoice HTTP API] Background BullMQ worker started in this process.');
  } else {
    console.log('[GasInvoice HTTP API] Running in dedicated Web/API mode (Worker disabled in this process).');
  }

  // Health check
  app.get('/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      mode: ENV.APP_MODE,
      storageDriver: ENV.STORAGE_DRIVER,
      storageBucket: ENV.STORAGE_DRIVER !== 'local' ? ENV.S3_BUCKET : undefined,
      workerActive: Boolean(worker),
      uptime: process.uptime(),
      redis: ENV.REDIS_URL,
      recordVideo: ENV.RECORD_VIDEO,
      dryRun: ENV.DRY_RUN,
      timestamp: new Date().toISOString(),
    });
  });

  // Public server configuration
  app.get('/api/config', (_req: Request, res: Response) => {
    res.json({
      success: true,
      storageDriver: ENV.STORAGE_DRIVER,
      recordVideo: ENV.RECORD_VIDEO,
      dryRun: ENV.DRY_RUN,
    });
  });

  // Catalogs (Régimen Fiscal, Uso CFDI, Formas de Pago)
  app.get('/api/catalogs', (_req: Request, res: Response) => {
    res.json({
      success: true,
      regimenes: RegimenesFiscalesCatalog,
      usosCfdi: UsosCfdiCatalog,
      formasPago: FormasPagoCatalog,
    });
  });

  // Supported gas stations catalog
  app.get('/api/stations', (_req: Request, res: Response) => {
    try {
      const stationsPath = path.resolve(process.cwd(), 'config', 'supported_stations.json');
      if (fs.existsSync(stationsPath)) {
        const data = JSON.parse(fs.readFileSync(stationsPath, 'utf-8'));
        return res.json({ success: true, stations: data });
      }
      return res.json({
        success: true,
        stations: [
          {
            id: 'gogas',
            name: 'GoGas',
            domain: 'facturasgas.com',
            status: 'active',
            statusText: 'Disponible',
            description: 'Red FacturasGas / GoGas',
          },
        ],
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Default / Test profile endpoint
  app.get('/api/profile', (_req: Request, res: Response) => {
    try {
      const profilePath = path.resolve(process.cwd(), 'config', 'billing_profile.json');
      if (fs.existsSync(profilePath)) {
        const profile = JSON.parse(fs.readFileSync(profilePath, 'utf-8'));
        return res.json({ success: true, profile });
      }
      return res.json({ success: false, profile: null });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // Save / Update profile endpoint
  app.post('/api/profile', (req: Request, res: Response) => {
    try {
      const profile = req.body;
      if (!profile || !profile.rfc) {
        return res.status(400).json({ success: false, error: 'Perfil inválido: falta RFC' });
      }
      const profilePath = path.resolve(process.cwd(), 'config', 'billing_profile.json');
      fs.writeFileSync(profilePath, JSON.stringify(profile, null, 2), 'utf-8');
      return res.json({ success: true, profile });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // Scan receipt(s) on-the-fly with OCR and return parsed metadata for user review/edit
  // Supports single or multiple files
  app.post('/api/receipts/scan', upload.array('receipts', 10), async (req: Request, res: Response) => {
    try {
      const files = req.files as Express.Multer.File[];
      if (!files || files.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'No se subieron imágenes de recibos. Selecciona al menos un archivo.',
        });
      }

      const receiptsDir = path.join(ENV.SCREENSHOT_DIR, 'receipts');
      if (!fs.existsSync(receiptsDir)) {
        fs.mkdirSync(receiptsDir, { recursive: true });
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
          const ext = path.extname(file.originalname) || '.png';
          const savedFileName = `receipt_${Date.now()}_${i}${ext}`;
          const key = `receipts/${savedFileName}`;

          const uploadResult = await storageService.upload(key, file.buffer, {
            contentType: file.mimetype || 'image/png',
          });
          const receiptImageUrl = uploadResult.url;

          const parsed = await service.parseReceiptOnly(file.buffer);
          parsed.receiptImageUrl = receiptImageUrl;

          parsedResults.push({
            index: i,
            filename: file.originalname,
            success: true,
            receipt: parsed,
          });
        } catch (err: any) {
          parsedResults.push({
            index: i,
            filename: file.originalname,
            success: false,
            error: err.message || 'No se pudo extraer texto del ticket',
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
  });

  // Enqueue invoice job(s) in BullMQ
  app.post('/api/queue/invoice', async (req: Request, res: Response) => {
    try {
      const { items, receiptData, billingProfile, recordVideo, dryRun } = req.body;

      if (!billingProfile || !billingProfile.rfc) {
        return res.status(400).json({
          success: false,
          error: 'Faltan los datos del perfil de facturación (RFC es requerido).',
        });
      }

      const jobsToQueue: Array<{ receiptData: ParsedReceiptData; billingProfile: BillingProfile }> = [];

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
          error: 'No se enviaron datos de recibos para facturar.',
        });
      }

      // Verify duplicate tracking number against existing history
      const existingHistory = await RedisHistoryService.getHistoryByRfc(billingProfile.rfc);
      const registeredTickets = new Set(
        existingHistory
          .map((h) => (h.trackingNumber || '').trim().toUpperCase())
          .filter((t) => t.length > 0)
      );

      const duplicates = jobsToQueue
        .map((j) => (j.receiptData.trackingNumber || '').trim())
        .filter((trk) => trk.length > 0 && registeredTickets.has(trk.toUpperCase()));

      if (duplicates.length > 0) {
        return res.status(409).json({
          success: false,
          error: `El ticket "${duplicates.join(', ')}" ya se encuentra registrado en tu historial. No se permite reenviarlo.`,
          duplicateTickets: duplicates,
        });
      }

      const enqueuedJobs = [];
      for (const item of jobsToQueue) {
        const job = await addInvoiceJob({
          receiptData: item.receiptData,
          billingProfile: item.billingProfile,
          recordVideo: recordVideo !== undefined ? recordVideo : ENV.RECORD_VIDEO,
          dryRun: dryRun !== undefined ? dryRun : ENV.DRY_RUN,
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
          billingUrl: item.receiptData.billingUrl,
          amount: item.receiptData.amount,
          date: item.receiptData.date || new Date().toISOString().split('T')[0],
          timestamp: new Date().toISOString(),
          status: 'waiting',
          progress: 10,
          submitted: false,
          message: 'Esperando turno en cola...',
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
  app.get('/api/queue/jobs/:jobId', async (req: Request, res: Response) => {
    try {
      const jobId = String(req.params.jobId || '');
      const queue = getInvoiceQueue();
      const job = await queue.getJob(jobId);

      if (!job) {
        return res.status(404).json({
          success: false,
          error: `Proceso con ID #${jobId} no encontrado en la cola.`,
        });
      }

      const state = await job.getState();
      const progress = job.progress;

      let screenshotUrl: string | undefined;
      let videoUrl: string | undefined;

      if (job.returnvalue?.screenshotPath) {
        const filename = job.returnvalue.screenshotPath.split('/').pop();
        screenshotUrl = `/output/${filename}`;
      }

      if (job.returnvalue?.videoPath) {
        const filename = job.returnvalue.videoPath.split('/').pop();
        videoUrl = `/output/videos/${filename}`;
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
            }
          : null,
        failedReason: job.failedReason || null,
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Automation history for a given RFC (from Redis, including real-time active/waiting jobs)
  app.get('/api/history/:rfc', async (req: Request, res: Response) => {
    try {
      const rfc = String(req.params.rfc || '').trim().toUpperCase();
      if (!rfc) {
        return res.status(400).json({ success: false, error: 'RFC es requerido.' });
      }

      const history = await RedisHistoryService.getHistoryByRfc(rfc);

      // Sync active/waiting jobs with real-time BullMQ progress
      const queue = getInvoiceQueue();
      for (const item of history) {
        if ((item.status === 'waiting' || item.status === 'active') && item.jobId) {
          try {
            const bJob = await queue.getJob(item.jobId);
            if (bJob) {
              const state = await bJob.getState();
              if (typeof bJob.progress === 'number') {
                item.progress = bJob.progress;
              }
              if (state === 'active') {
                item.status = 'active';
                if (!item.message || item.message === 'Esperando turno en cola...') {
                  item.message = 'Navegando y facturando en portal...';
                }
              } else if (state === 'completed') {
                item.status = 'completed';
                item.progress = 100;
                if (bJob.returnvalue?.screenshotPath) {
                  const fn = bJob.returnvalue.screenshotPath.split('/').pop();
                  item.screenshotUrl = `/output/${fn}`;
                }
                if (bJob.returnvalue?.videoPath) {
                  const fn = bJob.returnvalue.videoPath.split('/').pop();
                  item.videoUrl = `/output/videos/${fn}`;
                }
              } else if (state === 'failed') {
                item.status = 'failed';
                item.progress = 100;
                item.error = bJob.failedReason || item.error;
              }
            }
          } catch {}
        }
      }

      const cleanHistory = RedisHistoryService.deduplicateList(history);

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
  app.delete('/api/history/:id', async (req: Request, res: Response) => {
    try {
      const id = String(req.params.id || '');
      const rfc = String(req.query.rfc || req.body?.rfc || '').trim().toUpperCase();
      if (!rfc) {
        return res.status(400).json({ success: false, error: 'RFC es requerido para eliminar del historial.' });
      }

      const history = await RedisHistoryService.getHistoryByRfc(rfc);
      const entry = history.find(
        (h) => h.id === id || h.jobId === id || `hist_${h.jobId}` === id || h.trackingNumber === id
      );

      // If there's an associated BullMQ job in queue/processing, remove/cancel it
      const targetJobId = entry?.jobId || id;
      if (targetJobId) {
        try {
          const queue = getInvoiceQueue();
          const job = await queue.getJob(targetJobId);
          if (job) {
            await job.remove();
            console.log(`[Queue] Removed/cancelled job ${targetJobId} on user deletion.`);
          }
        } catch (queueErr: any) {
          console.warn(`[Queue] Could not remove job ${targetJobId}:`, queueErr.message);
        }
      }

      const deleted = await RedisHistoryService.deleteEntry(rfc, id);
      return res.json({ success: deleted || Boolean(entry) });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // Download Invoice PDF
  app.get('/api/invoices/:id/pdf', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const ticket = String(req.query.ticket || id);

      // Check local storage / output directory first
      const outputDir = path.resolve(ENV.SCREENSHOT_DIR);
      if (fs.existsSync(outputDir)) {
        const files = fs.readdirSync(outputDir).filter((f) => f.includes(ticket) && f.endsWith('.pdf'));
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
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="factura_${ticket}.pdf"`);
        return res.send(pdfBuffer);
      }

      return res.status(404).json({ success: false, error: 'Comprobante PDF no disponible aún para este ticket.' });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  return {
    app,
    worker,
    start: () =>
      new Promise<void>((resolve) => {
        const host = options.host || ENV.HOST || '0.0.0.0';
        app.listen(port, host, () => {
          console.log(`[GasInvoice HTTP API] Server running on http://${host}:${port}`);
          console.log(`[GasInvoice HTTP API] Redis connection: ${ENV.REDIS_URL}`);
          resolve();
        });
      }),
  };
}

if (process.argv[1]?.endsWith('http/server.ts') || process.argv[1]?.endsWith('http/server.js')) {
  createHttpServer(ENV.PORT)
    .then((s) => s.start())
    .catch((err) => {
      console.error('[GasInvoice HTTP API] Fatal error:', err);
      process.exit(1);
    });
}
