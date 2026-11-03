import fp from 'fastify-plugin';
import { Redis } from 'ioredis';
import type { FastifyPluginAsync } from 'fastify';
import { config } from '../config.js';

declare module 'fastify' {
  interface FastifyInstance {
    redis: Redis;
  }
}

const redisPlugin: FastifyPluginAsync = async (fastify) => {
  const redis = new Redis(config.REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: 3,
  });

  await redis.connect();

  fastify.decorate('redis', redis);

  fastify.addHook('onClose', async () => {
    await redis.quit();
  });
};

export default fp(redisPlugin, { name: 'redis' });
