import { ENV } from './config/env.js';
import { createHttpServer } from './interfaces/http/server.js';
import { startInvoiceWorker } from './infrastructure/queue/invoiceWorker.js';
import { StorageFactory } from './infrastructure/storage/storageFactory.js';
import { Logger } from './utils/logger.js';

async function bootstrap() {
  const mode = ENV.APP_MODE;
  console.log(`\n======================================================`);
  console.log(`[CombusTicket] Starting application (APP_MODE="${mode}")`);
  console.log(`======================================================\n`);

  // Ensure storage (local directories or MinIO/S3 bucket) is ready
  const storage = StorageFactory.getStorageService();
  if (storage.init) {
    try {
      await storage.init();
    } catch (storageErr: any) {
      Logger.error('Bootstrap', `Storage initialization notice: ${storageErr.message}`);
    }
  }

  if (mode === 'worker') {
    console.log('[CombusTicket Worker] Initializing dedicated BullMQ Worker daemon...');
    console.log(`[CombusTicket Worker] Connecting to Redis: ${ENV.REDIS_URL}`);
    const worker = startInvoiceWorker();

    const gracefulShutdown = async (signal: string) => {
      console.log(`\n[CombusTicket Worker] Received ${signal}. Gracefully closing worker...`);
      try {
        await worker.close();
        console.log('[CombusTicket Worker] Worker closed cleanly.');
        process.exit(0);
      } catch (err: any) {
        console.error('[CombusTicket Worker] Error during shutdown:', err.message);
        process.exit(1);
      }
    };

    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

    console.log('[CombusTicket Worker] Worker listening for gas invoice jobs.\n');
  } else if (mode === 'web' || mode === 'api') {
    console.log('[CombusTicket Web] Initializing Web UI & REST API server...');
    const server = await createHttpServer(ENV.PORT, { enableWorker: false });
    await server.start();
  } else {
    // Monolithic / Full mode: runs both web API and worker together
    console.log('[CombusTicket All-in-One] Initializing Monolithic mode (Web + Worker)...');
    const server = await createHttpServer(ENV.PORT, { enableWorker: true });
    await server.start();
  }
}

bootstrap().catch((err) => {
  console.error('[CombusTicket] Fatal error during bootstrap:', err);
  process.exit(1);
});
