import { Page } from 'playwright-core';
import { ParsedReceiptData, BillingProfile, AutomationOptions, InvoiceResult, PortalDescriptor } from '../types.js';

export interface IBillingPortalAdapter {
  readonly descriptor: PortalDescriptor;

  /**
   * Evaluates whether this adapter knows how to process the given receipt
   * based on billing URL domain, gas station brand name, station number, etc.
   */
  canHandle(receipt: ParsedReceiptData): boolean;

  /**
   * Executes the browser automation steps for this specific portal.
   */
  execute(
    page: Page,
    receipt: ParsedReceiptData,
    profile: BillingProfile,
    options?: AutomationOptions
  ): Promise<InvoiceResult>;
}
