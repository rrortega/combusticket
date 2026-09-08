import { chromium, Browser } from 'playwright-core';
import fs from 'fs';
import path from 'path';
import { IOcrEngine } from '../core/interfaces/IOcrEngine.js';
import { IBrowserManager } from '../core/interfaces/IBrowserManager.js';
import { BillingPortalRegistry } from '../adapters/portalRegistry.js';
import { ReceiptParser } from '../ocr/receiptParser.js';
import { OcrEngineFactory } from '../ocr/ocrFactory.js';
import { ObscuraManager } from '../browser/obscuraManager.js';
import { FacturasGasAdapter } from '../adapters/facturasGas/FacturasGasAdapter.js';
import { GenericGasAdapter } from '../adapters/generic/GenericGasAdapter.js';
import { ENV } from '../config/env.js';
import { IStorageService } from '../core/interfaces/IStorageService.js';
import { StorageFactory } from '../infrastructure/storage/storageFactory.js';
import {
  ParsedReceiptData,
  BillingProfile,
  AutomationOptions,
  InvoiceResult,
  PortalDescriptor,
} from '../core/types.js';

export interface GasInvoiceServiceOptions {
  profilePath?: string;
  defaultProfile?: BillingProfile;
  storageService?: IStorageService;
}

export class GasInvoiceService {
  private readonly storageService: IStorageService;

  constructor(
    private readonly ocrEngine: IOcrEngine,
    private readonly browserManager: IBrowserManager,
    private readonly portalRegistry: BillingPortalRegistry,
    private readonly receiptParser: ReceiptParser = new ReceiptParser(),
    private readonly options: GasInvoiceServiceOptions = {}
  ) {
    this.storageService = options.storageService || StorageFactory.getStorageService();
  }

  public static async createDefault(options: GasInvoiceServiceOptions = {}): Promise<GasInvoiceService> {
    const ocrEngine = await OcrEngineFactory.createEngine();
    const browserManager = new ObscuraManager({ port: 9222, stealth: true });
    const registry = new BillingPortalRegistry();

    // Register supported portal adapters
    registry.register(new FacturasGasAdapter());
    registry.register(new GenericGasAdapter());

    return new GasInvoiceService(ocrEngine, browserManager, registry, new ReceiptParser(), options);
  }

  public getSupportedPortals(): PortalDescriptor[] {
    return this.portalRegistry.list();
  }

  public loadBillingProfile(customPath?: string): BillingProfile {
    if (this.options.defaultProfile && !customPath) {
      return this.options.defaultProfile;
    }

    const resolvedPath =
      customPath ||
      this.options.profilePath ||
      path.resolve(process.cwd(), 'config', 'billing_profile.json');

    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`Billing profile not found at: ${resolvedPath}`);
    }

    const raw = fs.readFileSync(resolvedPath, 'utf-8');
    return JSON.parse(raw);
  }

  public async parseReceiptOnly(imagePathOrBuffer: string | Buffer): Promise<ParsedReceiptData> {
    const ocrOutput = await this.ocrEngine.recognize(imagePathOrBuffer);
    if (!ocrOutput.success) {
      throw new Error(ocrOutput.error || 'Failed to extract text from receipt');
    }
    return this.receiptParser.parse(ocrOutput);
  }

  private executionQueue: Promise<any> = Promise.resolve();

  public async processReceipt(
    imagePathOrBuffer: string | Buffer,
    profileOverride?: BillingProfile,
    options: AutomationOptions = {}
  ): Promise<InvoiceResult> {
    // Acquire mutex lock to ensure browser executions never collide on CDP port
    const currentQueue = this.executionQueue;
    let releaseLock!: (value?: any) => void;
    this.executionQueue = new Promise((resolve) => {
      releaseLock = resolve;
    });

    try {
      await currentQueue;
      return await this.executeProcessReceipt(imagePathOrBuffer, profileOverride, options);
    } finally {
      releaseLock();
    }
  }

  public async processReceiptData(
    receiptData: ParsedReceiptData,
    profile: BillingProfile,
    options: AutomationOptions = {}
  ): Promise<InvoiceResult> {
    const currentQueue = this.executionQueue;
    let releaseLock!: (value?: any) => void;
    this.executionQueue = new Promise((resolve) => {
      releaseLock = resolve;
    });

    try {
      await currentQueue;
      return await this.executeBrowserAutomation(receiptData, profile, options);
    } finally {
      releaseLock();
    }
  }

  private async executeProcessReceipt(
    imagePathOrBuffer: string | Buffer,
    profileOverride?: BillingProfile,
    options: AutomationOptions = {}
  ): Promise<InvoiceResult> {
    console.log('\n======================================================');
    console.log('[GasInvoiceService] Starting receipt processing pipeline');
    console.log('======================================================\n');

    // 1. OCR Step
    console.log(`[1/4] Running OCR with engine: ${this.ocrEngine.name}...`);
    const ocrOutput = await this.ocrEngine.recognize(imagePathOrBuffer);
    if (!ocrOutput.success) {
      throw new Error(ocrOutput.error || 'OCR recognition failed');
    }

    // 2. Parse receipt fields
    console.log('[2/4] Parsing structured receipt metadata...');
    const receiptData = this.receiptParser.parse(ocrOutput);
    console.log('Extracted Data:');
    console.log(`  - Gasolinera:    ${receiptData.gasStation}`);
    console.log(`  - No. Estación:  ${receiptData.stationNumber || 'N/A'}`);
    console.log(`  - No. Rastreo:   ${receiptData.trackingNumber || 'NOT FOUND'}`);
    console.log(`  - Transacción:   ${receiptData.transaction || 'N/A'}`);
    console.log(`  - Fecha:         ${receiptData.date || 'N/A'}`);
    console.log(`  - Medio de Pago: ${receiptData.paymentMethod}`);
    console.log(`  - Total:         $${receiptData.amount.toFixed(2)}`);
    console.log(`  - Portal Web:    ${receiptData.billingUrl}`);

    if (!receiptData.trackingNumber) {
      throw new Error('Tracking number (No. Rastreo) could not be extracted from receipt image.');
    }

    const profile = profileOverride || this.loadBillingProfile();
    return await this.executeBrowserAutomation(receiptData, profile, options);
  }

  private async executeBrowserAutomation(
    receiptData: ParsedReceiptData,
    profile: BillingProfile,
    options: AutomationOptions = {}
  ): Promise<InvoiceResult> {
    // 3. Resolve portal adapter
    console.log('\n[Portal Resolver] Resolving billing portal adapter...');
    const adapter = this.portalRegistry.resolve(receiptData);
    console.log(`Selected Adapter: ${adapter.descriptor.name} [id: ${adapter.descriptor.id}]`);
    console.log(`Billing Profile: ${profile.razonSocial} (RFC: ${profile.rfc})`);

    const recordVideo = options.recordVideo !== undefined ? options.recordVideo : ENV.RECORD_VIDEO;
    const dryRun = options.dryRun !== undefined ? options.dryRun : ENV.DRY_RUN;
    const effectiveOptions: AutomationOptions = {
      ...options,
      recordVideo,
      dryRun,
    };

    // 4. Execute Browser Automation
    console.log('\n[Browser Automation] Launching Obscura agent browser daemon and connecting via Playwright...');
    const cdpUrl = await this.browserManager.start();
    console.log(`Obscura ready at CDP: ${cdpUrl}`);

    const videoDir = path.resolve(effectiveOptions.videoDir || ENV.VIDEO_DIR);
    if (recordVideo && !fs.existsSync(videoDir)) {
      fs.mkdirSync(videoDir, { recursive: true });
    }

    const browser: Browser = await chromium.connectOverCDP(cdpUrl);

    try {
      const context = await browser.newContext({
        recordVideo: recordVideo
          ? {
              dir: videoDir,
              size: { width: 1280, height: 800 },
            }
          : undefined,
      });

      const page = await context.newPage();

      try {
        // Delegate automation execution to the resolved adapter
        const result = await adapter.execute(page, receiptData, profile, effectiveOptions);
        console.log(`\nAdapter execution finished: ${result.message}`);

        // If recording video, wait a moment to capture the final validated state
        if (recordVideo) {
          await page.waitForTimeout(2000);
        }

        // Close page so Playwright flushes video
        await page.close();
        await context.close();

        if (recordVideo) {
          const video = page.video();
          if (video) {
            try {
              const rawVideoPath = await video.path();
              if (rawVideoPath && fs.existsSync(rawVideoPath)) {
                const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                const destName = `${adapter.descriptor.id}_${timestamp}.webm`;
                const finalVideoPath = path.join(videoDir, destName);
                fs.renameSync(rawVideoPath, finalVideoPath);
                result.videoPath = finalVideoPath;
                console.log(`[GasInvoiceService] Video recorded and saved: ${finalVideoPath}`);
              }
            } catch (vErr) {
              console.warn('[GasInvoiceService] Note: Video path resolution:', vErr);
            }
          }
        }

        // Upload generated evidence artifacts to configured storage service (local, s3, or minio)
        if (result.screenshotPath && fs.existsSync(result.screenshotPath)) {
          try {
            const fileName = path.basename(result.screenshotPath);
            const uploadRes = await this.storageService.uploadFromPath(
              `screenshots/${fileName}`,
              result.screenshotPath
            );
            result.screenshotUrl = uploadRes.url;
          } catch (err: any) {
            console.warn('[GasInvoiceService] Storage upload error for screenshot:', err.message);
          }
        }

        if (result.videoPath && fs.existsSync(result.videoPath)) {
          try {
            const fileName = path.basename(result.videoPath);
            const uploadRes = await this.storageService.uploadFromPath(
              `videos/${fileName}`,
              result.videoPath
            );
            result.videoUrl = uploadRes.url;
          } catch (err: any) {
            console.warn('[GasInvoiceService] Storage upload error for video:', err.message);
          }
        }

        if (result.pdfPath && fs.existsSync(result.pdfPath)) {
          try {
            const fileName = path.basename(result.pdfPath);
            const uploadRes = await this.storageService.uploadFromPath(
              `invoices/${fileName}`,
              result.pdfPath
            );
            result.pdfUrl = uploadRes.url;
          } catch (err: any) {
            console.warn('[GasInvoiceService] Storage upload error for PDF:', err.message);
          }
        }

        return result;
      } finally {
        await page.close().catch(() => {});
        await context.close().catch(() => {});
      }
    } finally {
      await browser.close().catch(() => {});
      await this.browserManager.stop();
    }
  }
}
