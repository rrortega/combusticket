import { Worker, Job } from 'bullmq';
import { getRedisClient } from '../redis/redisClient.js';
import { INVOICE_QUEUE_NAME, InvoiceJobData } from './invoiceQueue.js';
import { GasInvoiceService } from '../../services/gasInvoiceService.js';
import { RedisHistoryService, InvoiceHistoryEntry } from '../storage/redisHistory.js';
import { InvoiceResult } from '../../core/types.js';
import { Logger } from '../../utils/logger.js';
import { PushNotificationService } from '../notifications/pushNotificationService.js';

let invoiceWorker: Worker<InvoiceJobData, InvoiceResult> | null = null;

export function startInvoiceWorker(): Worker<InvoiceJobData, InvoiceResult> {
  if (invoiceWorker) {
    return invoiceWorker;
  }

  const redis = getRedisClient();

  invoiceWorker = new Worker<InvoiceJobData, InvoiceResult>(
    INVOICE_QUEUE_NAME,
    async (job: Job<InvoiceJobData, InvoiceResult>) => {
      const startTime = Date.now();
      const ticket = job.data.receiptData.trackingNumber || 'N/A';
      const rfc = job.data.billingProfile.rfc;
      const razon = job.data.billingProfile.razonSocial;
      const station = job.data.receiptData.gasStation || 'Desconocida';
      const amount = Number(job.data.receiptData.amount || 0).toFixed(2);
      const isDryRun = Boolean(job.data.dryRun);

      Logger.info(
        'Worker',
        `\n======================================================\n` +
        `🚀 [Job #${job.id}] INVOICE PROCESSING STARTED\n` +
        `  • Ticket:       ${ticket}\n` +
        `  • Gasolinera:   ${station} (${job.data.receiptData.stationNumber || 'Sin Estación'})\n` +
        `  • Monto:        $${amount}\n` +
        `  • Portal:       ${job.data.receiptData.billingUrl || 'Auto-detect'}\n` +
        `  • RFC:          ${rfc} (${razon})\n` +
        `  • Modo:         ${isDryRun ? 'DRY-RUN (Simulación sin enviar)' : 'REAL (Solicitar Factura)'}\n` +
        `  • Grabar Video: ${job.data.recordVideo ? 'SÍ' : 'NO'}\n` +
        `======================================================`
      );

      Logger.debug('Worker', `[Job #${job.id}] Full Payload:`, {
        receipt: job.data.receiptData,
        billing: job.data.billingProfile,
        options: { recordVideo: job.data.recordVideo, dryRun: job.data.dryRun },
      });

      Logger.step('Worker', '1/4', `[Job #${job.id}] Initializing state in Redis history (20%)...`);
      await job.updateProgress(15);
      await RedisHistoryService.upsertEntry({
        id: `hist_${job.id}`,
        jobId: job.id,
        rfc: job.data.billingProfile.rfc,
        razonSocial: job.data.billingProfile.razonSocial,
        trackingNumber: job.data.receiptData.trackingNumber,
        gasStation: job.data.receiptData.gasStation,
        stationNumber: job.data.receiptData.stationNumber,
        billingUrl: job.data.receiptData.billingUrl,
        amount: job.data.receiptData.amount,
        date: job.data.receiptData.date || new Date().toISOString().split('T')[0],
        timestamp: new Date().toISOString(),
        status: 'active',
        progress: 20,
        submitted: false,
        message: 'Iniciando navegador y cargando portal...',
      });

      try {
        Logger.step('Worker', '2/4', `[Job #${job.id}] Spawning browser & navigating to billing portal (45%)...`);
        const service = await GasInvoiceService.createDefault();
        await job.updateProgress(40);
        await RedisHistoryService.upsertEntry({
          id: `hist_${job.id}`,
          jobId: job.id,
          rfc: job.data.billingProfile.rfc,
          trackingNumber: job.data.receiptData.trackingNumber,
          status: 'active',
          progress: 45,
          message: 'Navegando y llenando formulario fiscal...',
        });

        Logger.step('Worker', '3/4', `[Job #${job.id}] Executing portal automation adapter...`);
        const result = await service.processReceiptData(
          job.data.receiptData,
          job.data.billingProfile,
          {
            recordVideo: job.data.recordVideo,
            dryRun: job.data.dryRun,
          }
        );

        Logger.step('Worker', '4/4', `[Job #${job.id}] Processing results and archiving artifacts (85%)...`);
        await job.updateProgress(85);

        // Map paths to web accessible URLs
        const screenshotFileName = result.screenshotPath ? result.screenshotPath.split('/').pop() : undefined;
        const videoFileName = result.videoPath ? result.videoPath.split('/').pop() : undefined;
        const pdfFileName = result.pdfPath ? result.pdfPath.split('/').pop() : undefined;

        const isSuccess = Boolean(result.success && (result.submitted || job.data.dryRun));
        const status: InvoiceHistoryEntry['status'] = job.data.dryRun
          ? 'dry_run'
          : (isSuccess ? 'completed' : 'failed');

        const historyEntry: InvoiceHistoryEntry = {
          id: `hist_${job.id}`,
          jobId: job.id,
          rfc: job.data.billingProfile.rfc,
          razonSocial: job.data.billingProfile.razonSocial,
          trackingNumber: job.data.receiptData.trackingNumber,
          gasStation: job.data.receiptData.gasStation,
          stationNumber: job.data.receiptData.stationNumber,
          billingUrl: job.data.receiptData.billingUrl,
          amount: job.data.receiptData.amount,
          date: job.data.receiptData.date || new Date().toISOString().split('T')[0],
          timestamp: new Date().toISOString(),
          status,
          progress: 100,
          submitted: Boolean(result.submitted),
          screenshotUrl:
            result.screenshotUrl ||
            (screenshotFileName ? `/output/${screenshotFileName}` : undefined),
          videoUrl:
            result.videoUrl ||
            (videoFileName ? `/output/videos/${videoFileName}` : undefined),
          pdfUrl:
            result.pdfUrl ||
            (pdfFileName ? `/output/${pdfFileName}` : undefined),
          receiptImageUrl: job.data.receiptData.receiptImageUrl || job.data.receiptData.previewUrl,
          message: result.message,
          error: !isSuccess ? result.message : undefined,
        };

        await RedisHistoryService.saveEntry(historyEntry);
        await PushNotificationService.notifyInvoiceOutcome(historyEntry).catch((pushErr) => {
          Logger.warn('Worker', `Push notification dispatch warning: ${pushErr.message}`);
        });
        await job.updateProgress(100);

        const durationSec = ((Date.now() - startTime) / 1000).toFixed(2);

        if (!isSuccess) {
          Logger.warn(
            'Worker',
            `⚠️ [Job #${job.id}] Finished with rejection/unsuccessful state in ${durationSec}s: "${result.message}"\n` +
            `  • Screenshot: ${historyEntry.screenshotUrl || 'N/A'}\n` +
            `  • Video:      ${historyEntry.videoUrl || 'N/A'}`
          );
        } else {
          Logger.info(
            'Worker',
            `✨ [Job #${job.id}] COMPLETED SUCCESSFULLY in ${durationSec}s!\n` +
            `  • Mensaje:    ${result.message}\n` +
            `  • Facturado:  ${result.submitted ? 'SÍ (Timbrado solicitado)' : 'NO (Dry-run verificado)'}\n` +
            `  • Screenshot: ${historyEntry.screenshotUrl || 'N/A'}\n` +
            `  • PDF:        ${historyEntry.pdfUrl || 'N/A'}\n` +
            `  • Video:      ${historyEntry.videoUrl || 'N/A'}`
          );
        }
        return result;
      } catch (err: any) {
        const durationSec = ((Date.now() - startTime) / 1000).toFixed(2);
        Logger.error('Worker', `❌ [Job #${job.id}] FAILED after ${durationSec}s: ${err.message}`);
        if (Logger.isDebugEnabled() && err.stack) {
          Logger.debug('Worker', `[Job #${job.id}] Error Stack:`, err.stack);
        }

        // Record failed attempt in history as well so user knows what happened
        const failedEntry: InvoiceHistoryEntry = {
          id: `hist_${job.id}`,
          jobId: job.id,
          rfc: job.data.billingProfile.rfc,
          razonSocial: job.data.billingProfile.razonSocial,
          trackingNumber: job.data.receiptData.trackingNumber,
          gasStation: job.data.receiptData.gasStation,
          stationNumber: job.data.receiptData.stationNumber,
          billingUrl: job.data.receiptData.billingUrl,
          amount: job.data.receiptData.amount,
          date: job.data.receiptData.date || new Date().toISOString().split('T')[0],
          timestamp: new Date().toISOString(),
          status: 'failed',
          progress: 100,
          submitted: false,
          receiptImageUrl: job.data.receiptData.receiptImageUrl || job.data.receiptData.previewUrl,
          message: 'Error durante la automatización',
          error: err.message,
        };

        await RedisHistoryService.saveEntry(failedEntry).catch(() => {});
        await PushNotificationService.notifyInvoiceOutcome(failedEntry).catch(() => {});
        throw err;
      }
    },
    {
      connection: redis,
      concurrency: 1, // Strictly 1 browser instance at a time
    }
  );

  // BullMQ Worker Lifecycle Event Listeners for transparent stdout monitoring
  invoiceWorker.on('ready', () => {
    Logger.info('Worker', `🟢 Worker is READY and listening for jobs on queue "${INVOICE_QUEUE_NAME}"`);
  });

  invoiceWorker.on('active', (job: Job<InvoiceJobData, InvoiceResult>) => {
    Logger.info('Worker', `🟡 Job #${job.id} is now ACTIVE (Thread locked for processing)`);
  });

  invoiceWorker.on('progress', (job: Job<InvoiceJobData, InvoiceResult>, progress: any) => {
    Logger.info('Worker', `⏳ Job #${job.id} progress updated: ${typeof progress === 'number' ? `${progress}%` : JSON.stringify(progress)}`);
  });

  invoiceWorker.on('completed', (job: Job<InvoiceJobData, InvoiceResult>) => {
    Logger.info('Worker', `✅ Job #${job.id} successfully finished and resolved.`);
  });

  invoiceWorker.on('failed', (job: Job<InvoiceJobData, InvoiceResult> | undefined, err: Error) => {
    Logger.error('Worker', `❌ Job #${job?.id} failed with error: ${err.message}`);
  });

  invoiceWorker.on('error', (err: Error) => {
    Logger.error('Worker', `💥 Worker connection / internal error: ${err.message}`);
  });

  invoiceWorker.on('stalled', (jobId: string) => {
    Logger.warn('Worker', `⚠️ Job #${jobId} stalled (execution lock timed out or process restarted)`);
  });

  return invoiceWorker;
}

