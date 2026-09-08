import { Worker, Job } from 'bullmq';
import { getRedisClient } from '../redis/redisClient.js';
import { INVOICE_QUEUE_NAME, InvoiceJobData } from './invoiceQueue.js';
import { GasInvoiceService } from '../../services/gasInvoiceService.js';
import { RedisHistoryService, InvoiceHistoryEntry } from '../storage/redisHistory.js';
import { InvoiceResult } from '../../core/types.js';

let invoiceWorker: Worker<InvoiceJobData, InvoiceResult> | null = null;

export function startInvoiceWorker(): Worker<InvoiceJobData, InvoiceResult> {
  if (invoiceWorker) {
    return invoiceWorker;
  }

  const redis = getRedisClient();

  invoiceWorker = new Worker<InvoiceJobData, InvoiceResult>(
    INVOICE_QUEUE_NAME,
    async (job: Job<InvoiceJobData, InvoiceResult>) => {
      console.log(`\n======================================================`);
      console.log(`[InvoiceWorker] Processing Job #${job.id} for ticket: ${job.data.receiptData.trackingNumber}`);
      console.log(`[InvoiceWorker] Billing to RFC: ${job.data.billingProfile.rfc} (${job.data.billingProfile.razonSocial})`);
      console.log(`======================================================\n`);

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

        const result = await service.processReceiptData(
          job.data.receiptData,
          job.data.billingProfile,
          {
            recordVideo: job.data.recordVideo,
            dryRun: job.data.dryRun,
          }
        );

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
          screenshotUrl: screenshotFileName ? `/output/${screenshotFileName}` : undefined,
          videoUrl: videoFileName ? `/output/videos/${videoFileName}` : undefined,
          pdfUrl: pdfFileName ? `/output/${pdfFileName}` : undefined,
          receiptImageUrl: job.data.receiptData.receiptImageUrl || job.data.receiptData.previewUrl,
          message: result.message,
          error: !isSuccess ? result.message : undefined,
        };

        await RedisHistoryService.saveEntry(historyEntry);
        await job.updateProgress(100);

        if (!isSuccess) {
          console.warn(`[InvoiceWorker] Job #${job.id} finished with rejection/failure: ${result.message}`);
        } else {
          console.log(`[InvoiceWorker] Job #${job.id} completed successfully.`);
        }
        return result;
      } catch (err: any) {
        console.error(`[InvoiceWorker] Job #${job.id} failed:`, err.message);

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
        throw err;
      }
    },
    {
      connection: redis,
      concurrency: 1, // Strictly 1 browser instance at a time
    }
  );

  invoiceWorker.on('ready', () => {
    console.log(`[InvoiceWorker] Worker is listening for jobs on queue "${INVOICE_QUEUE_NAME}"`);
  });

  invoiceWorker.on('failed', (job, err) => {
    console.error(`[InvoiceWorker] Job #${job?.id} reported failure:`, err.message);
  });

  return invoiceWorker;
}
