import { ENV } from './config/env.js';
import { createHttpServer } from './interfaces/http/server.js';
import { startInvoiceWorker } from './infrastructure/queue/invoiceWorker.js';

async function bootstrap() {
  const mode = ENV.APP_MODE;
  console.log(`\n======================================================`);
  console.log(`[FacturaGas] Starting application (APP_MODE="${mode}")`);
  console.log(`======================================================\n`);

  if (mode === 'worker') {
    console.log('[FacturaGas Worker] Initializing dedicated BullMQ Worker daemon...');
    console.log(`[FacturaGas Worker] Connecting to Redis: ${ENV.REDIS_URL}`);
    const worker = startInvoiceWorker();

    const gracefulShutdown = async (signal: string) => {
      console.log(`\n[FacturaGas Worker] Received ${signal}. Gracefully closing worker...`);
      try {
        await worker.close();
        console.log('[FacturaGas Worker] Worker closed cleanly.');
        process.exit(0);
      } catch (err: any) {
        console.error('[FacturaGas Worker] Error during shutdown:', err.message);
        process.exit(1);
      }
    };

    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

    console.log('[FacturaGas Worker] Worker listening for gas invoice jobs.\n');
  } else if (mode === 'web' || mode === 'api') {
    console.log('[FacturaGas Web] Initializing Web UI & REST API server...');
    const server = await createHttpServer(ENV.PORT, { enableWorker: false });
    await server.start();
  } else {
    // Monolithic / Full mode: runs both web API and worker together
    console.log('[FacturaGas All-in-One] Initializing Monolithic mode (Web + Worker)...');
    const server = await createHttpServer(ENV.PORT, { enableWorker: true });
    await server.start();
  }
}

bootstrap().catch((err) => {
  console.error('[FacturaGas] Fatal error during bootstrap:', err);
  process.exit(1);
});
