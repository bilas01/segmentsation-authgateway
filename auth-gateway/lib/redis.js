'use strict';
const Redis = require('ioredis');

const redis = new Redis(process.env.REDIS_URL, {
  maxRetriesPerRequest: 3,
  retryStrategy: (times) => Math.min(times * 100, 3000),
  lazyConnect: false,
});

redis.on('connect',  () => console.log('[redis] Connecté'));
redis.on('error',    (err) => console.error('[redis] Erreur:', err.message));

module.exports = { redis };
