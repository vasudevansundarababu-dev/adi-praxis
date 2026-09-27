import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { Prisma } from '@prisma/client';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { randomUUID } from 'node:crypto';
import './auth/actor';
import { rbacPlugin } from './auth/rbac';
import type { Config } from './config';
import type { Db } from './db';
import { AppError } from './lib/errors';
import { authRoutes } from './routes/auth';
import { healthRoutes } from './routes/health';
import { jobDescriptionRoutes } from './routes/job-descriptions';
import { candidateRoutes } from './routes/candidates';
import { projectRoutes } from './routes/projects';
import { staffingRoutes } from './routes/staffing';
import { OfflineGeocoder, type Geocoder } from './staffing/geocoder';
import { stubSelectionGate, type SelectionGate } from './staffing/selection-gate';
import { taxonomyRoutes } from './routes/taxonomy';
import { templateRoutes } from './routes/templates';
import { userRoutes } from './routes/users';

export interface AppDeps {
  config: Config;
  db: Db;
  pingRedis: () => Promise<boolean>;
  logger?: boolean;
  /** Defaults: offline city table; M3 selection stub (replaced in M4). */
  geocoder?: Geocoder;
  selectionGate?: SelectionGate;
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: deps.logger ?? false,
    genReqId: (req) => {
      const incoming = req.headers['x-request-id'];
      return typeof incoming === 'string' && /^[\w-]{1,100}$/.test(incoming) ? incoming : randomUUID();
    },
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.addHook('onSend', async (req, reply) => {
    reply.header('x-request-id', req.id);
  });

  app.setErrorHandler((err, req, reply) => {
    const requestId = String(req.id);
    if (err instanceof AppError) {
      return reply
        .status(err.statusCode)
        .send({ error: err.code, message: err.message, requestId, ...(err.details !== undefined ? { details: err.details } : {}) });
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return reply.status(409).send({ error: 'CONFLICT', message: 'A record with these values already exists', requestId });
    }
    const e = err as { validation?: unknown; statusCode?: number; code?: string; message: string };
    if (e.validation) {
      return reply.status(400).send({ error: 'VALIDATION_FAILED', message: e.message, requestId });
    }
    if (e.statusCode && e.statusCode < 500) {
      return reply.status(e.statusCode).send({ error: e.code ?? 'BAD_REQUEST', message: e.message, requestId });
    }
    req.log.error({ err }, 'unhandled error');
    return reply.status(500).send({ error: 'INTERNAL', message: 'Something went wrong', requestId });
  });

  await app.register(cookie);
  await app.register(cors, {
    origin: deps.config.CORS_ORIGINS,
    credentials: true,
    allowedHeaders: ['content-type', 'idempotency-key', 'x-request-id'],
  });
  await app.register(rateLimit, { global: false });
  await app.register(swagger, {
    openapi: {
      info: { title: 'ADI Praxis API', version: '0.1.0' },
      servers: [{ url: '/' }],
      components: {
        securitySchemes: { session: { type: 'apiKey', in: 'cookie', name: 'praxis_session' } },
      },
    },
    transform: jsonSchemaTransform,
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });
  await app.register(rbacPlugin, { db: deps.db });

  await app.register(healthRoutes, { db: deps.db, pingRedis: deps.pingRedis });
  await app.register(
    async (v1) => {
      v1.get('/openapi.json', { config: { access: 'public' }, schema: { hide: true } }, async () => app.swagger());
      await v1.register(authRoutes, { db: deps.db, config: deps.config });
      await v1.register(userRoutes, { db: deps.db });
      await v1.register(templateRoutes, { db: deps.db });
      await v1.register(taxonomyRoutes, { db: deps.db });
      await v1.register(jobDescriptionRoutes, { db: deps.db });
      await v1.register(projectRoutes, { db: deps.db });
      await v1.register(staffingRoutes, {
        db: deps.db,
        geocoder: deps.geocoder ?? new OfflineGeocoder(),
        selectionGate: deps.selectionGate ?? stubSelectionGate,
      });
      await v1.register(candidateRoutes, { db: deps.db });
    },
    { prefix: '/api/v1' },
  );

  return app;
}
