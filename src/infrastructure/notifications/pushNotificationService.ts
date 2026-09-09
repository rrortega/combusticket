import webpush from 'web-push';
import { getRedisClient } from '../redis/redisClient.js';
import { ENV } from '../../config/env.js';
import { Logger } from '../../utils/logger.js';
import { InvoiceHistoryEntry } from '../storage/redisHistory.js';

export interface WebPushSubscription {
  endpoint: string;
  expirationTime?: number | null;
  keys: {
    p256dh: string;
    auth: string;
  };
}

export interface PushNotificationPayload {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  tag?: string;
  data?: {
    url?: string;
    jobId?: string;
    ticket?: string;
    status?: string;
    [key: string]: any;
  };
}

const REDIS_ALL_SUBS_KEY = 'combusticket:push:subscriptions';
const REDIS_RFC_SUBS_PREFIX = 'combusticket:push:rfc:';

export class PushNotificationService {
  private static initialized = false;

  public static init(): void {
    if (this.initialized) return;

    if (ENV.VAPID_PUBLIC_KEY && ENV.VAPID_PRIVATE_KEY) {
      try {
        webpush.setVapidDetails(
          ENV.VAPID_SUBJECT,
          ENV.VAPID_PUBLIC_KEY,
          ENV.VAPID_PRIVATE_KEY
        );
        this.initialized = true;
        Logger.info('WebPush', 'VAPID credentials configured successfully.');
      } catch (err: any) {
        Logger.error('WebPush', `Failed to configure VAPID details: ${err.message}`);
      }
    } else {
      Logger.warn('WebPush', 'VAPID keys not configured. Push notifications are disabled.');
    }
  }

  public static getPublicKey(): string {
    return ENV.VAPID_PUBLIC_KEY;
  }

  public static async saveSubscription(
    subscription: WebPushSubscription,
    rfc?: string
  ): Promise<void> {
    this.init();
    const redis = getRedisClient();
    const endpoint = subscription.endpoint;
    const serialized = JSON.stringify(subscription);

    // Save to global set of subscriptions (keyed by endpoint)
    await redis.hset(REDIS_ALL_SUBS_KEY, endpoint, serialized);

    // If scoped by RFC, add to RFC index set
    if (rfc) {
      const cleanRfc = rfc.trim().toUpperCase();
      await redis.sadd(`${REDIS_RFC_SUBS_PREFIX}${cleanRfc}`, endpoint);
      Logger.debug('WebPush', `Saved subscription for RFC "${cleanRfc}": ${endpoint.slice(0, 45)}...`);
    } else {
      Logger.debug('WebPush', `Saved general subscription: ${endpoint.slice(0, 45)}...`);
    }
  }

  public static async removeSubscription(endpoint: string, rfc?: string): Promise<void> {
    const redis = getRedisClient();
    await redis.hdel(REDIS_ALL_SUBS_KEY, endpoint);
    if (rfc) {
      const cleanRfc = rfc.trim().toUpperCase();
      await redis.srem(`${REDIS_RFC_SUBS_PREFIX}${cleanRfc}`, endpoint);
    }
    Logger.debug('WebPush', `Removed stale subscription: ${endpoint.slice(0, 45)}...`);
  }

  public static async sendToSubscription(
    subscription: WebPushSubscription,
    payload: PushNotificationPayload
  ): Promise<boolean> {
    this.init();
    try {
      const stringifiedPayload = JSON.stringify({
        title: payload.title,
        body: payload.body,
        icon: payload.icon || '/icons/icon-192x192.png',
        badge: payload.badge || '/favicon-32x32.png',
        tag: payload.tag || 'invoice-notification',
        data: payload.data || { url: '/' },
      });

      await webpush.sendNotification(subscription as any, stringifiedPayload);
      Logger.debug('WebPush', `Notification sent to endpoint: ${subscription.endpoint.slice(0, 45)}...`);
      return true;
    } catch (err: any) {
      const statusCode = err.statusCode;
      if (statusCode === 410 || statusCode === 404) {
        Logger.warn('WebPush', `Subscription expired or unsubscribed (${statusCode}). Pruning endpoint.`);
        await this.removeSubscription(subscription.endpoint);
      } else {
        Logger.error('WebPush', `Failed to send push notification (${statusCode || err.message})`);
      }
      return false;
    }
  }

  public static async sendToRfc(
    rfc: string,
    payload: PushNotificationPayload
  ): Promise<number> {
    const redis = getRedisClient();
    const cleanRfc = rfc.trim().toUpperCase();
    const endpoints = await redis.smembers(`${REDIS_RFC_SUBS_PREFIX}${cleanRfc}`);

    if (!endpoints || endpoints.length === 0) {
      Logger.debug('WebPush', `No push subscriptions registered for RFC: "${cleanRfc}". Falling back to broadcast.`);
      return this.broadcast(payload);
    }

    let successCount = 0;
    for (const endpoint of endpoints) {
      const raw = await redis.hget(REDIS_ALL_SUBS_KEY, endpoint);
      if (!raw) {
        await redis.srem(`${REDIS_RFC_SUBS_PREFIX}${cleanRfc}`, endpoint);
        continue;
      }

      try {
        const sub: WebPushSubscription = JSON.parse(raw);
        const sent = await this.sendToSubscription(sub, payload);
        if (sent) successCount++;
      } catch {
        await redis.hdel(REDIS_ALL_SUBS_KEY, endpoint);
        await redis.srem(`${REDIS_RFC_SUBS_PREFIX}${cleanRfc}`, endpoint);
      }
    }

    return successCount;
  }

  public static async broadcast(payload: PushNotificationPayload): Promise<number> {
    const redis = getRedisClient();
    const all = await redis.hgetall(REDIS_ALL_SUBS_KEY);
    const endpoints = Object.keys(all);

    if (endpoints.length === 0) {
      Logger.debug('WebPush', 'No active push subscriptions found in Redis.');
      return 0;
    }

    let successCount = 0;
    for (const endpoint of endpoints) {
      try {
        const sub: WebPushSubscription = JSON.parse(all[endpoint]);
        const sent = await this.sendToSubscription(sub, payload);
        if (sent) successCount++;
      } catch {
        await redis.hdel(REDIS_ALL_SUBS_KEY, endpoint);
      }
    }

    return successCount;
  }

  public static async notifyInvoiceOutcome(entry: InvoiceHistoryEntry): Promise<void> {
    const isSuccess = entry.status === 'completed' || entry.status === 'dry_run';
    const ticket = entry.trackingNumber || 'Ticket';
    const amount = entry.amount ? `$${Number(entry.amount).toFixed(2)}` : '';
    const station = entry.gasStation || 'Gasolinera';

    let title: string;
    let body: string;

    if (entry.status === 'dry_run') {
      title = `🧪 Simulación Completada (${ticket})`;
      body = `El formulario para ${station} (${amount}) fue validado correctamente en modo Dry-Run.`;
    } else if (entry.status === 'completed') {
      title = `🧾 ¡Factura Generada! (${ticket})`;
      body = `Tu factura de ${station} por ${amount} fue emitida y completada con éxito.`;
    } else {
      title = `⚠️ Facturación no completada (${ticket})`;
      body = `El portal rechazó el ticket o requiere atención: ${entry.error || entry.message || 'Error desconocido'}`;
    }

    const payload: PushNotificationPayload = {
      title,
      body,
      icon: '/icons/icon-192x192.png',
      badge: '/favicon-32x32.png',
      tag: `invoice-${entry.jobId || ticket}`,
      data: {
        url: entry.screenshotUrl || '/',
        jobId: entry.jobId,
        ticket: entry.trackingNumber,
        status: entry.status,
      },
    };

    if (entry.rfc) {
      await this.sendToRfc(entry.rfc, payload);
    } else {
      await this.broadcast(payload);
    }
  }
}
