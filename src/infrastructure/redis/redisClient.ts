import { Redis } from 'ioredis';
import { ENV } from '../../config/env.js';

let sharedRedis: Redis | null = null;

export function getRedisClient(): Redis {
  if (!sharedRedis) {
    sharedRedis = new Redis(ENV.REDIS_URL, {
      maxRetriesPerRequest: null,
      lazyConnect: false,
    });

    sharedRedis.on('error', (err) => {
      console.error('[Redis] Connection error:', err.message);
    });

    sharedRedis.on('connect', () => {
      console.log(`[Redis] Connected successfully to ${ENV.REDIS_URL}`);
    });
  }

  return sharedRedis;
}

export function createRedisConnection(): Redis {
  return new Redis(ENV.REDIS_URL, {
    maxRetriesPerRequest: null,
  });
}
