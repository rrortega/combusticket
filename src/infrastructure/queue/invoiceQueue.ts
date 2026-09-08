import { Queue, Job } from 'bullmq';
import { getRedisClient } from '../redis/redisClient.js';
import { ParsedReceiptData, BillingProfile } from '../../core/types.js';

export const INVOICE_QUEUE_NAME = 'gas-invoices';

export interface InvoiceJobData {
  receiptData: ParsedReceiptData;
  billingProfile: BillingProfile;
  recordVideo?: boolean;
  dryRun?: boolean;
  takeScreenshot?: boolean;
}

let invoiceQueue: Queue<InvoiceJobData> | null = null;

export function getInvoiceQueue(): Queue<InvoiceJobData> {
  if (!invoiceQueue) {
    const redis = getRedisClient();
    invoiceQueue = new Queue<InvoiceJobData>(INVOICE_QUEUE_NAME, {
      connection: redis,
      defaultJobOptions: {
        attempts: 1,
        removeOnComplete: 100,
        removeOnFail: 200,
      },
    });
    console.log(`[InvoiceQueue] BullMQ Queue initialized: "${INVOICE_QUEUE_NAME}"`);
  }
  return invoiceQueue;
}

export async function addInvoiceJob(
  data: InvoiceJobData,
  jobName = 'process-gas-invoice'
): Promise<Job<InvoiceJobData>> {
  const queue = getInvoiceQueue();
  const job = await queue.add(jobName, data);
  console.log(`[InvoiceQueue] Added job ${job.id} for ticket: ${data.receiptData.trackingNumber}`);
  return job;
}
