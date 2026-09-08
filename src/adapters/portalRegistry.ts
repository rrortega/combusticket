import { IBillingPortalAdapter } from '../core/interfaces/IBillingPortalAdapter.js';
import { ParsedReceiptData, PortalDescriptor } from '../core/types.js';

export class BillingPortalRegistry {
  private adapters: Map<string, IBillingPortalAdapter> = new Map();

  public register(adapter: IBillingPortalAdapter): void {
    if (this.adapters.has(adapter.descriptor.id)) {
      console.warn(`[BillingPortalRegistry] Overwriting adapter for portal id: ${adapter.descriptor.id}`);
    }
    this.adapters.set(adapter.descriptor.id, adapter);
  }

  public resolve(receipt: ParsedReceiptData): IBillingPortalAdapter {
    for (const adapter of this.adapters.values()) {
      if (adapter.canHandle(receipt)) {
        return adapter;
      }
    }

    const available = Array.from(this.adapters.values())
      .map((a) => `${a.descriptor.name} (${a.descriptor.supportedDomains.join(', ')})`)
      .join('; ');

    throw new Error(
      `No billing portal adapter found for station "${receipt.gasStation}" and URL "${receipt.billingUrl}". ` +
      `Supported portals: ${available || 'None'}`
    );
  }

  public list(): PortalDescriptor[] {
    return Array.from(this.adapters.values()).map((a) => a.descriptor);
  }

  public getById(id: string): IBillingPortalAdapter | undefined {
    return this.adapters.get(id);
  }
}
