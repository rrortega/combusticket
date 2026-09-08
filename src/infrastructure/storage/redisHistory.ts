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

  private static getLockKey(rfc: string): string {
    return `facturagas:lock:${rfc.trim().toUpperCase()}`;
  }

  private static async withLock<T>(rfc: string, fn: () => Promise<T>): Promise<T> {
    const redis = getRedisClient();
    const lockKey = this.getLockKey(rfc);
    const token = `${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const ttlMs = 8000;
    const maxWaitMs = 10000;
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitMs) {
      const acquired = await redis.set(lockKey, token, 'PX', ttlMs, 'NX');
      if (acquired === 'OK') {
        try {
          return await fn();
        } finally {
          const luaRelease = `
            if redis.call("get", KEYS[1]) == ARGV[1] then
              return redis.call("del", KEYS[1])
            else
              return 0
            end
          `;
          await redis.eval(luaRelease, 1, lockKey, token).catch(() => {});
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 35));
    }

    console.warn(`[RedisHistory] Lock acquisition timed out for RFC ${rfc}, proceeding without lock.`);
    return await fn();
  }

  public static entriesMatch(a: InvoiceHistoryEntry, b: Partial<InvoiceHistoryEntry>): boolean {
    // 1. Match by numeric or string jobId
    if (a.jobId && b.jobId && String(a.jobId) === String(b.jobId)) {
      return true;
    }

    // 2. Match by exact id or hist_ prefix
    if (a.id && b.id && (a.id === b.id || a.id === `hist_${b.jobId}` || b.id === `hist_${a.jobId}`)) {
      return true;
    }

    // 3. Cross match id and jobId
    if (a.jobId && b.id && (b.id === String(a.jobId) || b.id === `hist_${a.jobId}`)) {
      return true;
    }
    if (b.jobId && a.id && (a.id === String(b.jobId) || a.id === `hist_${b.jobId}`)) {
      return true;
    }

    // 4. Match by tracking number if valid and non-empty
    const aTrack = (a.trackingNumber || '').trim().toUpperCase();
    const bTrack = (b.trackingNumber || '').trim().toUpperCase();
    if (aTrack && bTrack && aTrack !== '---' && bTrack !== '---' && aTrack === bTrack) {
      return true;
    }

    return false;
  }

  public static deduplicateList(entries: InvoiceHistoryEntry[]): InvoiceHistoryEntry[] {
    const result: InvoiceHistoryEntry[] = [];
    for (const entry of entries) {
      const existingIndex = result.findIndex((item) => this.entriesMatch(item, entry));
      if (existingIndex >= 0) {
        const existing = result[existingIndex];
        const statusPriority: Record<string, number> = {
          completed: 4,
          failed: 3,
          active: 2,
          waiting: 1,
          dry_run: 4,
        };

        const existingPriority = statusPriority[existing.status] || 0;
        const newPriority = statusPriority[entry.status] || 0;
        const preferredStatus = newPriority >= existingPriority ? entry.status : existing.status;

        result[existingIndex] = {
          ...existing,
          ...entry,
          status: preferredStatus,
          progress: Math.max(existing.progress || 0, entry.progress || 0),
          submitted: existing.submitted || !!entry.submitted,
          screenshotUrl: entry.screenshotUrl || existing.screenshotUrl,
          videoUrl: entry.videoUrl || existing.videoUrl,
          pdfUrl: entry.pdfUrl || existing.pdfUrl,
          receiptImageUrl: entry.receiptImageUrl || existing.receiptImageUrl,
          message: entry.message || existing.message,
          error: entry.error || existing.error,
        };
      } else {
        result.push(entry);
      }
    }
    return result;
  }

  public static async upsertEntry(entry: Partial<InvoiceHistoryEntry> & { rfc: string }): Promise<void> {
    const normalizedRfc = entry.rfc.trim().toUpperCase();
    return this.withLock(normalizedRfc, async () => {
      try {
        const redis = getRedisClient();
        const key = this.getKey(normalizedRfc);
        const rows = await redis.lrange(key, 0, -1);

        const existingEntries: InvoiceHistoryEntry[] = [];
        for (const row of rows) {
          try {
            existingEntries.push(JSON.parse(row));
          } catch {}
        }

        let matched = false;
        for (let i = 0; i < existingEntries.length; i++) {
          if (this.entriesMatch(existingEntries[i], entry)) {
            existingEntries[i] = {
              ...existingEntries[i],
              ...entry,
            };
            matched = true;
            break;
          }
        }

        if (!matched) {
          const fullEntry: InvoiceHistoryEntry = {
            id: entry.id || `hist_${entry.jobId || Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
            jobId: entry.jobId ? String(entry.jobId) : undefined,
            rfc: normalizedRfc,
            razonSocial: entry.razonSocial || '',
            trackingNumber: entry.trackingNumber || '---',
            gasStation: entry.gasStation || 'GOGAS',
            stationNumber: entry.stationNumber,
            billingUrl: entry.billingUrl,
            amount: entry.amount || 0,
            date: entry.date || new Date().toISOString().split('T')[0],
            timestamp: entry.timestamp || new Date().toISOString(),
            status: entry.status || 'waiting',
            progress: entry.progress !== undefined ? entry.progress : 10,
            submitted: !!entry.submitted,
            screenshotUrl: entry.screenshotUrl,
            videoUrl: entry.videoUrl,
            pdfUrl: entry.pdfUrl,
            receiptImageUrl: entry.receiptImageUrl,
            message: entry.message || '',
            error: entry.error,
          };
          existingEntries.unshift(fullEntry);
        }

        const cleanList = this.deduplicateList(existingEntries);
        const serialized = cleanList.map((e) => JSON.stringify(e));

        const pipeline = redis.multi();
        pipeline.del(key);
        if (serialized.length > 0) {
          pipeline.rpush(key, ...serialized);
        }
        await pipeline.exec();

        console.log(`[RedisHistory] Upserted entry (${entry.status || 'saved'}) for RFC: ${normalizedRfc} (Job: ${entry.jobId || entry.id})`);
      } catch (err: any) {
        console.error('[RedisHistory] Error upserting entry in Redis:', err.message);
      }
    });
  }

  public static async saveEntry(entry: InvoiceHistoryEntry): Promise<void> {
    await this.upsertEntry(entry);
  }

  public static async getHistoryByRfc(rfc: string): Promise<InvoiceHistoryEntry[]> {
    try {
      const redis = getRedisClient();
      const key = this.getKey(rfc);
      const rows = await redis.lrange(key, 0, -1);
      const list: InvoiceHistoryEntry[] = [];
      for (const r of rows) {
        try {
          list.push(JSON.parse(r) as InvoiceHistoryEntry);
        } catch {}
      }
      return this.deduplicateList(list);
    } catch (err: any) {
      console.error('[RedisHistory] Error fetching history from Redis:', err.message);
      return [];
    }
  }

  public static async deleteEntry(rfc: string, entryId: string): Promise<boolean> {
    const normalizedRfc = rfc.trim().toUpperCase();
    return this.withLock(normalizedRfc, async () => {
      try {
        const redis = getRedisClient();
        const key = this.getKey(normalizedRfc);
        const rows = await redis.lrange(key, 0, -1);
        let found = false;

        const remaining: string[] = [];
        for (const row of rows) {
          try {
            const parsed = JSON.parse(row) as InvoiceHistoryEntry;
            const isMatch =
              parsed.id === entryId ||
              String(parsed.jobId) === String(entryId) ||
              `hist_${parsed.jobId}` === entryId ||
              parsed.trackingNumber === entryId;

            if (isMatch) {
              found = true;
            } else {
              remaining.push(row);
            }
          } catch {
            remaining.push(row);
          }
        }

        if (!found) return false;

        const pipeline = redis.multi();
        pipeline.del(key);
        if (remaining.length > 0) {
          pipeline.rpush(key, ...remaining);
        }
        await pipeline.exec();
        console.log(`[RedisHistory] Deleted history entry "${entryId}" for RFC: ${normalizedRfc}`);
        return true;
      } catch (err: any) {
        console.error('[RedisHistory] Error deleting entry from Redis:', err.message);
        return false;
      }
    });
  }
}
