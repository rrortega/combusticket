import { getRedisClient } from "../redis/redisClient.js";

export interface InvoiceHistoryEntry {
  id: string;
  jobId?: string;
  rfc: string;
  razonSocial: string;
  trackingNumber: string;
  gasStation: string;
  stationNumber?: string;
  address?: string;
  cashier?: string;
  paymentMethod?: string;
  liters?: number;
  fileHash?: string;
  receiptJsonUrl?: string;
  receiptBaseName?: string;
  imageFileName?: string;
  jsonFileName?: string;
  billingUrl?: string;
  amount: number;
  date: string;
  timestamp: string;
  status: "waiting" | "active" | "completed" | "failed" | "dry_run" | "scanned";
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
    return `combusticket:history:${rfc.trim().toUpperCase()}`;
  }

  private static getLegacyKey(rfc: string): string {
    return `facturagas:history:${rfc.trim().toUpperCase()}`;
  }

  private static getLockKey(rfc: string): string {
    return `combusticket:lock:${rfc.trim().toUpperCase()}`;
  }

  private static getTombstonesKey(rfc: string): string {
    return `combusticket:tombstones:${rfc.trim().toUpperCase()}`;
  }

  private static tombstoneTokens(
    entry: Partial<InvoiceHistoryEntry>,
  ): string[] {
    const tokens = new Set<string>();
    if (entry.id) tokens.add(`id:${entry.id}`);
    if (entry.jobId) tokens.add(`job:${String(entry.jobId)}`);
    if (entry.jobId) tokens.add(`id:hist_${String(entry.jobId)}`);
    if (entry.trackingNumber)
      tokens.add(`tracking:${entry.trackingNumber.trim().toUpperCase()}`);
    if (entry.fileHash) tokens.add(`hash:${entry.fileHash}`);
    return Array.from(tokens);
  }

  private static async withLock<T>(
    rfc: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    const redis = getRedisClient();
    const lockKey = this.getLockKey(rfc);
    const token = `${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const ttlMs = 8000;
    const maxWaitMs = 10000;
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitMs) {
      const acquired = await redis.set(lockKey, token, "PX", ttlMs, "NX");
      if (acquired === "OK") {
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

    console.warn(
      `[RedisHistory] Lock acquisition timed out for RFC ${rfc}, proceeding without lock.`,
    );
    return await fn();
  }

  public static entriesMatch(
    a: InvoiceHistoryEntry,
    b: Partial<InvoiceHistoryEntry>,
  ): boolean {
    // 1. Match by numeric or string jobId
    if (a.jobId && b.jobId && String(a.jobId) === String(b.jobId)) {
      return true;
    }

    // 2. Match by exact id or hist_ prefix
    if (
      a.id &&
      b.id &&
      (a.id === b.id ||
        a.id === `hist_${b.jobId}` ||
        b.id === `hist_${a.jobId}`)
    ) {
      return true;
    }

    // 3. Cross match id and jobId
    if (
      a.jobId &&
      b.id &&
      (b.id === String(a.jobId) || b.id === `hist_${a.jobId}`)
    ) {
      return true;
    }
    if (
      b.jobId &&
      a.id &&
      (a.id === String(b.jobId) || a.id === `hist_${b.jobId}`)
    ) {
      return true;
    }

    // 4. Match by tracking number if valid and non-empty
    const aTrack = (a.trackingNumber || "").trim().toUpperCase();
    const bTrack = (b.trackingNumber || "").trim().toUpperCase();
    if (
      aTrack &&
      bTrack &&
      aTrack !== "---" &&
      bTrack !== "---" &&
      aTrack === bTrack
    ) {
      return true;
    }

    // 5. Match by fileHash if valid
    if (a.fileHash && b.fileHash && a.fileHash === b.fileHash) {
      return true;
    }

    return false;
  }

  private static readonly REJECTION_REGEX =
    /rechaz[oó]|inv[aá]lido|incorrecto|no\s*admiti[oó]|no\s*existe|no\s*encontrado|ya\s*(?:fue|hab[ií]a\s*sido|se\s*encuentra)\s*facturado|no\s*avanz[oó]|no\s*devolvi[oó]\s*confirmaci[oó]n|no\s*se\s*pudo\s*confirmar|error|fall[oó]|alerta\s*del\s*portal|demasiados\s*intentos|fuera\s*de\s*tiempo|vencido|faltan\s*datos/i;

  private static readonly POSITIVE_SUCCESS_REGEX =
    /factura\s*(?:solicitada|generada|emitida|creada|enviada|registrada)|comprobante\s*fiscal|simulaci[oó]n\s*completada/i;

  public static isRejectedOrFailed(entry: Partial<InvoiceHistoryEntry>): boolean {
    if (entry.status === "waiting" || entry.status === "active") return false;
    if (entry.status === "failed") return true;
    const msg = entry.message || "";
    const err = entry.error || "";
    if (err && this.REJECTION_REGEX.test(err)) return true;
    if (msg && this.REJECTION_REGEX.test(msg)) return true;
    if (
      entry.status === "completed" &&
      entry.submitted === false &&
      !entry.pdfUrl &&
      !/simulaci[oó]n/i.test(msg) &&
      !this.POSITIVE_SUCCESS_REGEX.test(msg)
    ) {
      return true;
    }
    return false;
  }

  private static sanitizeEntry(entry: InvoiceHistoryEntry): InvoiceHistoryEntry {
    if (entry.status === "waiting" || entry.status === "active") {
      return {
        ...entry,
        error: undefined,
      };
    }
    if (this.isRejectedOrFailed(entry)) {
      return {
        ...entry,
        status: "failed",
        submitted: false,
        error: entry.error || entry.message || "La facturación fue rechazada por el portal.",
      };
    }
    if (entry.status === "completed" || entry.status === "dry_run") {
      return {
        ...entry,
        error: undefined,
      };
    }
    return entry;
  }

  public static deduplicateList(
    entries: InvoiceHistoryEntry[],
  ): InvoiceHistoryEntry[] {
    const result: InvoiceHistoryEntry[] = [];
    for (const rawEntry of entries) {
      const entry = this.sanitizeEntry(rawEntry);
      const existingIndex = result.findIndex((item) =>
        this.entriesMatch(item, entry),
      );
      if (existingIndex >= 0) {
        const existing = result[existingIndex];
        const statusPriority: Record<string, number> = {
          completed: 4,
          failed: 4,
          dry_run: 4,
          active: 2,
          waiting: 1,
        };

        const existingPriority = statusPriority[existing.status] || 0;
        const newPriority = statusPriority[entry.status] || 0;

        const isRetry =
          entry.status === "waiting" &&
          Boolean(entry.jobId && entry.jobId !== existing.jobId);
        const hasRejectionOrError = this.isRejectedOrFailed(entry);

        let preferredStatus: InvoiceHistoryEntry["status"];
        if (isRetry) {
          preferredStatus = "waiting";
        } else if (entry.status === "failed" || hasRejectionOrError) {
          preferredStatus = "failed";
        } else {
          preferredStatus = (newPriority >= existingPriority ? entry.status : existing.status) as any;
        }

        const isActuallyFailed = preferredStatus === "failed";

        result[existingIndex] = this.sanitizeEntry({
          ...existing,
          ...entry,
          status: preferredStatus,
          progress: Math.max(existing.progress || 0, entry.progress || 0),
          submitted: isActuallyFailed ? false : existing.submitted || !!entry.submitted,
          screenshotUrl: entry.screenshotUrl || existing.screenshotUrl,
          videoUrl: entry.videoUrl || existing.videoUrl,
          pdfUrl: entry.pdfUrl || existing.pdfUrl,
          receiptImageUrl: entry.receiptImageUrl || existing.receiptImageUrl,
          fileHash: entry.fileHash || existing.fileHash,
          receiptJsonUrl: entry.receiptJsonUrl || existing.receiptJsonUrl,
          receiptBaseName: entry.receiptBaseName || existing.receiptBaseName,
          imageFileName: entry.imageFileName || existing.imageFileName,
          jsonFileName: entry.jsonFileName || existing.jsonFileName,
          message: entry.message || existing.message,
          error:
            preferredStatus === "waiting" || preferredStatus === "completed" || preferredStatus === "dry_run"
              ? undefined
              : entry.error || (isActuallyFailed ? entry.message || existing.error : existing.error),
        });
      } else {
        result.push(entry);
      }
    }
    return result;
  }

  public static async upsertEntry(
    entry: Partial<InvoiceHistoryEntry> & { rfc: string },
  ): Promise<void> {
    const normalizedRfc = entry.rfc.trim().toUpperCase();
    return this.withLock(normalizedRfc, async () => {
      try {
        const redis = getRedisClient();
        if (await this.isEntryTombstoned(normalizedRfc, entry)) {
          console.warn(
            `[RedisHistory] Skipped upsert for tombstoned entry RFC: ${normalizedRfc} (Job: ${entry.jobId || entry.id})`,
          );
          return;
        }
        const key = this.getKey(normalizedRfc);
        const rows = await redis.lrange(key, 0, -1);

        const existingEntries: InvoiceHistoryEntry[] = [];
        for (const row of rows) {
          try {
            existingEntries.push(JSON.parse(row));
          } catch (parseErr: any) {
            console.warn(
              "[RedisHistory] Could not parse history row:",
              parseErr.message,
            );
          }
        }

        let matched = false;
        for (let i = 0; i < existingEntries.length; i++) {
          if (this.entriesMatch(existingEntries[i], entry)) {
            const prev = existingEntries[i];
            const isDiskRehydration = entry.progress === undefined && entry.status !== "waiting" && entry.status !== "active";
            const prevIsRunning = prev.status === "waiting" || prev.status === "active";

            let nextStatus = (entry.status || prev.status) as InvoiceHistoryEntry["status"];
            if (isDiskRehydration && prevIsRunning) {
              nextStatus = prev.status;
            } else if (this.isRejectedOrFailed(entry)) {
              nextStatus = "failed";
            } else if (
              isDiskRehydration &&
              prev.status === "failed" &&
              entry.status === "completed" &&
              entry.submitted === false
            ) {
              nextStatus = "failed";
            }

            existingEntries[i] = this.sanitizeEntry({
              ...prev,
              ...entry,
              status: nextStatus,
              progress:
                nextStatus === "waiting" && entry.progress !== undefined
                  ? entry.progress
                  : Math.max(prev.progress || 0, entry.progress || 0),
              submitted:
                nextStatus === "failed" || nextStatus === "waiting" || nextStatus === "active"
                  ? false
                  : Boolean(entry.submitted ?? prev.submitted),
              error:
                nextStatus === "waiting" || nextStatus === "active" || nextStatus === "completed" || nextStatus === "dry_run"
                  ? undefined
                  : entry.error || entry.message || prev.error || "La facturación fue rechazada por el portal.",
            });
            matched = true;
            break;
          }
        }

        if (!matched) {
          const fullEntry: InvoiceHistoryEntry = this.sanitizeEntry({
            id:
              entry.id ||
              `hist_${entry.jobId || Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
            jobId: entry.jobId ? String(entry.jobId) : undefined,
            rfc: normalizedRfc,
            razonSocial: entry.razonSocial || "",
            trackingNumber: entry.trackingNumber || "---",
            gasStation: entry.gasStation || "GOGAS",
            stationNumber: entry.stationNumber,
            cashier: entry.cashier,
            paymentMethod: entry.paymentMethod,
            liters: entry.liters,
            fileHash: entry.fileHash,
            receiptJsonUrl: entry.receiptJsonUrl,
            receiptBaseName: entry.receiptBaseName,
            imageFileName: entry.imageFileName,
            jsonFileName: entry.jsonFileName,
            billingUrl: entry.billingUrl,
            amount: entry.amount || 0,
            date: entry.date || new Date().toISOString().split("T")[0],
            timestamp: entry.timestamp || new Date().toISOString(),
            status: entry.status || "waiting",
            progress: entry.progress === undefined ? 10 : entry.progress,
            submitted: !!entry.submitted,
            screenshotUrl: entry.screenshotUrl,
            videoUrl: entry.videoUrl,
            pdfUrl: entry.pdfUrl,
            receiptImageUrl: entry.receiptImageUrl,
            message: entry.message || "",
            error: entry.error,
          });
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

        console.log(
          `[RedisHistory] Upserted entry (${entry.status || "saved"}) for RFC: ${normalizedRfc} (Job: ${entry.jobId || entry.id})`,
        );
      } catch (err: any) {
        console.error(
          "[RedisHistory] Error upserting entry in Redis:",
          err.message,
        );
      }
    });
  }

  public static async saveEntry(entry: InvoiceHistoryEntry): Promise<void> {
    await this.upsertEntry(entry);
  }

  public static async getHistoryByRfc(
    rfc: string,
  ): Promise<InvoiceHistoryEntry[]> {
    try {
      const redis = getRedisClient();
      const key = this.getKey(rfc);
      let rows = await redis.lrange(key, 0, -1);
      if (rows.length === 0) {
        const legacyRows = await redis.lrange(this.getLegacyKey(rfc), 0, -1);
        if (legacyRows.length > 0) {
          rows = legacyRows;
        }
      }
      const list: InvoiceHistoryEntry[] = [];
      for (const r of rows) {
        try {
          list.push(JSON.parse(r) as InvoiceHistoryEntry);
        } catch {}
      }
      return this.deduplicateList(list);
    } catch (err: any) {
      console.error(
        "[RedisHistory] Error fetching history from Redis:",
        err.message,
      );
      return [];
    }
  }

  public static async deleteEntry(
    rfc: string,
    entryId: string,
  ): Promise<InvoiceHistoryEntry | null> {
    const normalizedRfc = rfc.trim().toUpperCase();
    return this.withLock(normalizedRfc, async () => {
      try {
        const redis = getRedisClient();
        const key = this.getKey(normalizedRfc);
        const rows = await redis.lrange(key, 0, -1);
        let found: InvoiceHistoryEntry | null = null;

        const remaining: string[] = [];
        for (const row of rows) {
          try {
            const parsed = JSON.parse(row) as InvoiceHistoryEntry;
            const isMatch =
              parsed.id === entryId ||
              String(parsed.jobId) === String(entryId) ||
              `hist_${parsed.jobId}` === entryId ||
              parsed.trackingNumber === entryId ||
              parsed.fileHash === entryId;

            if (isMatch) {
              found = parsed;
            } else {
              remaining.push(row);
            }
          } catch (parseErr: any) {
            console.warn(
              "[RedisHistory] Could not parse history row during delete:",
              parseErr.message,
            );
            remaining.push(row);
          }
        }

        if (!found) return null;

        const tombstoneTokens = this.tombstoneTokens({ ...found, id: entryId });

        const pipeline = redis.multi();
        pipeline.del(key);
        if (remaining.length > 0) {
          pipeline.rpush(key, ...remaining);
        }
        if (tombstoneTokens.length > 0) {
          pipeline.sadd(
            this.getTombstonesKey(normalizedRfc),
            ...tombstoneTokens,
          );
        }
        await pipeline.exec();
        console.log(
          `[RedisHistory] Deleted history entry "${entryId}" for RFC: ${normalizedRfc}`,
        );
        return found;
      } catch (err: any) {
        console.error(
          "[RedisHistory] Error deleting entry from Redis:",
          err.message,
        );
        return null;
      }
    });
  }

  public static async removeStaleEntry(
    rfc: string,
    entryId: string,
  ): Promise<void> {
    const normalizedRfc = rfc.trim().toUpperCase();
    return this.withLock(normalizedRfc, async () => {
      try {
        const redis = getRedisClient();
        const key = this.getKey(normalizedRfc);
        const rows = await redis.lrange(key, 0, -1);
        const remaining: string[] = [];
        for (const row of rows) {
          try {
            const parsed = JSON.parse(row) as InvoiceHistoryEntry;
            if (
              parsed.id === entryId ||
              String(parsed.jobId) === String(entryId) ||
              parsed.receiptBaseName === entryId
            ) {
              continue;
            }
            remaining.push(row);
          } catch {
            remaining.push(row);
          }
        }
        const pipeline = redis.multi();
        pipeline.del(key);
        if (remaining.length > 0) {
          pipeline.rpush(key, ...remaining);
        }
        await pipeline.exec();
      } catch (err: any) {
        console.warn("[RedisHistory] Error removing stale entry:", err.message);
      }
    });
  }

  public static async tombstoneEntry(
    rfc: string,
    entry: Partial<InvoiceHistoryEntry>,
  ): Promise<void> {
    const tokens = this.tombstoneTokens(entry);
    if (tokens.length === 0) return;
    try {
      const redis = getRedisClient();
      await redis.sadd(this.getTombstonesKey(rfc), ...tokens);
    } catch (err: any) {
      console.warn(
        "[RedisHistory] Could not persist deletion tombstone:",
        err.message,
      );
    }
  }

  public static async untombstoneEntry(
    rfc: string,
    entry: Partial<InvoiceHistoryEntry>,
  ): Promise<void> {
    const tokens = this.tombstoneTokens(entry);
    if (tokens.length === 0) return;
    try {
      const redis = getRedisClient();
      await redis.srem(this.getTombstonesKey(rfc), ...tokens);
    } catch (err: any) {
      console.warn(
        "[RedisHistory] Could not remove deletion tombstone:",
        err.message,
      );
    }
  }

  public static async isEntryTombstoned(
    rfc: string,
    entry: Partial<InvoiceHistoryEntry>,
  ): Promise<boolean> {
    const tokens = this.tombstoneTokens(entry);
    if (tokens.length === 0) return false;
    try {
      const redis = getRedisClient();
      for (const token of tokens) {
        if (await redis.sismember(this.getTombstonesKey(rfc), token)) {
          return true;
        }
      }
    } catch (err: any) {
      console.warn(
        "[RedisHistory] Could not inspect deletion tombstone:",
        err.message,
      );
    }
    return false;
  }

  public static async unregisterFileHash(
    rfc: string,
    fileHash: string,
  ): Promise<void> {
    if (!fileHash) return;
    const cleanRfc = (rfc || "").trim().toUpperCase();
    if (!cleanRfc || cleanRfc === "TEMP") return;
    try {
      const redis = getRedisClient();
      await redis.srem(this.getHashesKey(cleanRfc), fileHash);
    } catch (err: any) {
      console.warn(
        "[RedisHistory] Could not unregister file hash in Redis:",
        err.message,
      );
    }
  }

  public static getHashesKey(rfc: string): string {
    return `combusticket:hashes:${rfc.trim().toUpperCase()}`;
  }

  public static async isFileHashRegistered(
    rfc: string,
    fileHash: string,
  ): Promise<boolean> {
    if (!fileHash) return false;
    const cleanRfc = (rfc || "").trim().toUpperCase();
    if (!cleanRfc || cleanRfc === "TEMP") return false;
    try {
      const redis = getRedisClient();
      const isMember = await redis.sismember(this.getHashesKey(cleanRfc), fileHash);
      if (isMember) return true;

      const history = await this.getHistoryByRfc(cleanRfc);
      return history.some((h) => h.fileHash === fileHash);
    } catch (err: any) {
      console.warn(
        "[RedisHistory] Could not inspect file hash registration:",
        err.message,
      );
      return false;
    }
  }

  public static async registerFileHash(
    rfc: string,
    fileHash: string,
  ): Promise<void> {
    if (!fileHash) return;
    const cleanRfc = (rfc || "").trim().toUpperCase();
    if (!cleanRfc || cleanRfc === "TEMP") return;
    try {
      const redis = getRedisClient();
      await redis.sadd(this.getHashesKey(cleanRfc), fileHash);
    } catch (err: any) {
      console.warn(
        "[RedisHistory] Could not register file hash in Redis:",
        err.message,
      );
    }
  }
}
