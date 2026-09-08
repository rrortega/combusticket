import { getRedisClient } from '../redis/redisClient.js';

export interface InvoiceHistoryEntry {
  id: string;
  jobId?: string;
  rfc: string;
  razonSocial: string;
  trackingNumber: string;
  gasStation: string;
  stationNumber?: string;
  billingUrl?: string;
  amount: number;
  date: string;
  timestamp: string;
  status: 'waiting' | 'active' | 'completed' | 'failed' | 'dry_run';
  progress?: number;
  submitted: boolean;
  screenshotUrl?: string;
  videoUrl?: string;
  pdfUrl?: string;
  receiptImageUrl?: string;
  message: string;
  error?: string;
}

export class RedisHistoryService {
  private static getKey(rfc: string): string {
    return `facturagas:history:${rfc.trim().toUpperCase()}`;
  }

  public static async upsertEntry(entry: Partial<InvoiceHistoryEntry> & { rfc: string }): Promise<void> {
    try {
      const redis = getRedisClient();
      const key = this.getKey(entry.rfc);
      const rows = await redis.lrange(key, 0, -1);
      let found = false;
      const updatedRows: string[] = [];

      for (const row of rows) {
        try {
          const parsed = JSON.parse(row) as InvoiceHistoryEntry;
          const isMatch =
            (entry.jobId && parsed.jobId && parsed.jobId === entry.jobId) ||
            (entry.id && parsed.id && parsed.id === entry.id) ||
            (entry.trackingNumber && parsed.trackingNumber === entry.trackingNumber &&
              (parsed.status === 'waiting' || parsed.status === 'active'));

          if (isMatch) {
            found = true;
            updatedRows.push(JSON.stringify({ ...parsed, ...entry }));
          } else {
            updatedRows.push(row);
          }
        } catch {
          updatedRows.push(row);
        }
      }

      if (found) {
        await redis.del(key);
        if (updatedRows.length > 0) {
          await redis.rpush(key, ...updatedRows);
        }
      } else {
        const fullEntry: InvoiceHistoryEntry = {
          id: entry.id || `hist_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          jobId: entry.jobId,
          rfc: entry.rfc,
          razonSocial: entry.razonSocial || '',
          trackingNumber: entry.trackingNumber || '---',
          gasStation: entry.gasStation || 'GOGAS',
          stationNumber: entry.stationNumber,
          amount: entry.amount || 0,
          date: entry.date || new Date().toISOString().split('T')[0],
          timestamp: entry.timestamp || new Date().toISOString(),
          status: entry.status || 'waiting',
          progress: entry.progress !== undefined ? entry.progress : 10,
          submitted: !!entry.submitted,
          screenshotUrl: entry.screenshotUrl,
          videoUrl: entry.videoUrl,
          message: entry.message || '',
          error: entry.error,
        };
        await redis.lpush(key, JSON.stringify(fullEntry));
      }
      console.log(`[RedisHistory] Upserted entry (${entry.status || 'saved'}) for RFC: ${entry.rfc} (Job: ${entry.jobId || entry.id})`);
    } catch (err: any) {
      console.error('[RedisHistory] Error upserting entry in Redis:', err.message);
    }
  }

  public static async saveEntry(entry: InvoiceHistoryEntry): Promise<void> {
    await this.upsertEntry(entry);
  }

  public static async getHistoryByRfc(rfc: string): Promise<InvoiceHistoryEntry[]> {
    try {
      const redis = getRedisClient();
      const key = this.getKey(rfc);
      const rows = await redis.lrange(key, 0, -1);
      return rows.map((r) => JSON.parse(r) as InvoiceHistoryEntry);
    } catch (err: any) {
      console.error('[RedisHistory] Error fetching history from Redis:', err.message);
      return [];
    }
  }

  public static async deleteEntry(rfc: string, entryId: string): Promise<boolean> {
    try {
      const redis = getRedisClient();
      const key = this.getKey(rfc);
      const rows = await redis.lrange(key, 0, -1);
      let found = false;

      const remaining: string[] = [];
      for (const row of rows) {
        const parsed = JSON.parse(row) as InvoiceHistoryEntry;
        if (
          parsed.id === entryId ||
          parsed.jobId === entryId ||
          `hist_${parsed.jobId}` === entryId ||
          parsed.trackingNumber === entryId
        ) {
          found = true;
        } else {
          remaining.push(row);
        }
      }

      if (!found) return false;

      await redis.del(key);
      if (remaining.length > 0) {
        await redis.rpush(key, ...remaining);
      }
      console.log(`[RedisHistory] Deleted history entry "${entryId}" for RFC: ${rfc}`);
      return true;
    } catch (err: any) {
      console.error('[RedisHistory] Error deleting entry from Redis:', err.message);
      return false;
    }
  }
}
