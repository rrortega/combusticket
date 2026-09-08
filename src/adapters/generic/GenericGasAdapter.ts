import { Page } from 'playwright-core';
import { IBillingPortalAdapter } from '../../core/interfaces/IBillingPortalAdapter.js';
import {
  ParsedReceiptData,
  BillingProfile,
  AutomationOptions,
  InvoiceResult,
  PortalDescriptor,
} from '../../core/types.js';
import { Logger } from '../../utils/logger.js';

export class GenericGasAdapter implements IBillingPortalAdapter {
  public readonly descriptor: PortalDescriptor = {
    id: 'generic-gas',
    name: 'Generic Gas Portal Adapter (Fallback)',
    supportedDomains: ['*'],
    supportedBrands: ['*'],
  };

  public canHandle(receipt: ParsedReceiptData): boolean {
    return true; // Catch-all fallback if registered last
  }

  public async execute(
    page: Page,
    receipt: ParsedReceiptData,
    profile: BillingProfile,
    options: AutomationOptions = {}
  ): Promise<InvoiceResult> {
    Logger.info('GenericGas', `Navigating to ${receipt.billingUrl}...`);
    await page.goto(receipt.billingUrl, { waitUntil: 'domcontentloaded', timeout: options.timeoutMs || 30000 });

    return {
      success: false,
      portalId: this.descriptor.id,
      receipt,
      billingProfile: profile,
      formFilled: false,
      submitted: false,
      message: `Generic fallback adapter reached. Specific adapter required for domain "${receipt.billingUrl}" or station "${receipt.gasStation}".`,
    };
  }
}
