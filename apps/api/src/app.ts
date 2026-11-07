import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { Prisma } from '@prisma/client';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  jsonSchemaTransform,
  hasZodFastifySchemaValidationErrors,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { randomUUID } from 'node:crypto';
import './auth/actor';
import { z } from 'zod';
import { rbacPlugin } from './auth/rbac';
import type { Config } from './config';
import type { Db } from './db';
import { AppError } from './lib/errors';
import { authRoutes } from './routes/auth';
import { healthRoutes } from './routes/health';
import { jobDescriptionRoutes } from './routes/job-descriptions';
import { GoogleIdTokenVerifier, MockGoogleVerifier, type GoogleVerifier } from './candidate/google';
import { MockIdentityProvider, StripeIdentityProvider, type IdentityProvider } from './candidate/identity-provider';
import { ClaudeVertexProfileAssistant, MockProfileAssistant, type ProfileAssistant } from './candidate/profile-assistant';
import { ClaudeVertexSuitabilityEvaluator, MockSuitabilityEvaluator, type SuitabilityEvaluator } from './candidate/suitability';
import { GcsStorage, stubScanner, type MalwareScanner, type ObjectStorage } from './candidate/storage';
import { campaignRoutes } from './routes/campaigns';
import { journeyRoutes } from './routes/journey';
import { taskRoutes } from './routes/tasks';
import { taskReviewRoutes } from './routes/task-review';
import { datasetRoutes } from './routes/dataset';
import { draftingRoutes } from './routes/drafting';
import { partnerApiRoutes } from './routes/partner-api';
import { partnerPortalRoutes } from './routes/partner-portal';
import { supplyCandidateRoutes } from './routes/supply-candidate';
import { supplyInternalRoutes } from './routes/supply-internal';
import { secretBox } from './lib/secrets';
import { certAdminRoutes } from './routes/cert-admin';
import { certCandidateRoutes } from './routes/cert-candidate';
import { paymentCandidateRoutes, paymentRoutes } from './routes/payments';
import { supportRoutes } from './routes/support';
import { ClaudeVertexSupportAssistant, MockSupportAssistant, type SupportAssistant } from './support/assistant';
import { MockPayoutProvider, TrolleyPayoutProvider, type PayoutProvider } from './pay/provider';
import { ClaudeVertexCurriculumGenerator, MockCurriculumGenerator, type CurriculumGenerator } from './cert/generator';
import { MockSelfieCheck, StripeSelfieCheck, type SelfieCheck } from './cert/selfie';
import { ClaudeVertexTaskDrafter, MockTaskDrafter, type TaskDrafter } from './tasks/drafting/drafter';
import { rlRoutes } from './routes/rl';
import { workRoutes } from './routes/work';
import { MemoryEmailSender, SmtpEmailSender, type EmailSender } from './lib/email';
import { HashingEmbeddingProvider, VertexEmbeddingProvider, type EmbeddingProvider } from './tasks/embeddings';
import { profileRoutes } from './routes/profile';
import { reviewRoutes } from './routes/review';
import { candidateAuthRoutes } from './routes/candidate-auth';
import { candidateRoutes } from './routes/candidates';
import { opportunityRoutes } from './routes/opportunities';
import { projectRoutes } from './routes/projects';
import { staffingRoutes } from './routes/staffing';
import { OfflineGeocoder, type Geocoder } from './staffing/geocoder';
import { dbSelectionGate, type SelectionGate } from './staffing/selection-gate';
import { taxonomyRoutes } from './routes/taxonomy';
import { templateRoutes } from './routes/templates';
import { metaCompilerRoutes } from './routes/meta-compiler';
import { metaCompilerRunRoutes } from './routes/meta-compiler-runs';
import { resolveDeps } from './meta-compiler/deps';
import { defaultDrafterFactory } from './meta-compiler/drafter';
import { defaultRunner } from './harbor/runner';
import type { MetaCompilerOverrides } from './meta-compiler/handlers';
import { userRoutes } from './routes/users';

export interface AppDeps {
  config: Config;
  db: Db;
  pingRedis: () => Promise<boolean>;
  logger?: boolean | Record<string, unknown>;
  /** Defaults: offline city table; the real selection gate (selected + onboarded + eligible). */
  geocoder?: Geocoder;
  selectionGate?: SelectionGate;
  /** Defaults follow config: real Google / Stripe when keys are set, local mocks otherwise. */
  google?: GoogleVerifier;
  identity?: IdentityProvider;
  /** The single v1 client candidates sign up under. Defaults to SEED_CLIENT_NAME, else the oldest client. */
  resolveClientId?: () => Promise<string>;
  /** SME profile assistant: Claude on Vertex when configured, otherwise the local mock. */
  assistant?: ProfileAssistant;
  /** Evidence storage (GCS; the emulator locally) and malware scanning (stub in v1). */
  storage?: ObjectStorage;
  scanner?: MalwareScanner;
  /** Suitability assessment (reviewer aid only): Claude on Vertex when configured, otherwise the local mock. */
  evaluator?: SuitabilityEvaluator;
  /** Invite email (SMTP / Mailpit locally, in-memory in tests) and near-duplicate embeddings (Vertex or hashing mock). */
  email?: EmailSender;
  embeddings?: EmbeddingProvider;
  /** M10b certification: course/test generator (Claude on Vertex or the mock) and the per-attempt selfie check. */
  curriculum?: CurriculumGenerator;
  selfie?: SelfieCheck;
  /** M10c payout provider: Trolley when configured, otherwise the mock. */
  payouts?: PayoutProvider;
  /** Support Bot: Claude on Vertex when configured, otherwise the local mock. */
  support?: SupportAssistant;
  /** Templates Meta-Compiler: drafters, Stream 1 functions and the Harbor runner. Defaults follow config. */
  metaCompiler?: MetaCompilerOverrides;
}

export function defaultSupport(config: Config): SupportAssistant {
  return config.assistantMode === 'vertex' ? new ClaudeVertexSupportAssistant({ projectId: config.VERTEX_PROJECT_ID, region: config.VERTEX_LOCATION, model: config.SUPPORT_MODEL }) : new MockSupportAssistant();
}

export function defaultPayouts(config: Config): PayoutProvider {
  return config.payoutMode === 'trolley'
    ? new TrolleyPayoutProvider({ accessKey: config.TROLLEY_ACCESS_KEY, secretKey: config.TROLLEY_SECRET_KEY, webhookSecret: config.TROLLEY_WEBHOOK_SECRET, apiUrl: config.TROLLEY_API_URL, widgetUrl: config.TROLLEY_WIDGET_URL, livemode: config.appEnv === 'production' })
    : new MockPayoutProvider(config.MOCK_SECRET, config.CANDIDATE_APP_URL);
}

/** M10b curriculum generator: Claude on Vertex (CERT_MODEL / CERT_BULK_MODEL) when configured, otherwise the mock. */
export function defaultCurriculum(config: Config): CurriculumGenerator {
  return config.assistantMode === 'vertex'
    ? new ClaudeVertexCurriculumGenerator({ projectId: config.VERTEX_PROJECT_ID, region: config.VERTEX_LOCATION, model: config.CERT_MODEL, bulkModel: config.CERT_BULK_MODEL })
    : new MockCurriculumGenerator();
}

export function defaultSelfie(config: Config): SelfieCheck {
  return config.identityMode === 'stripe' ? new StripeSelfieCheck(config.STRIPE_SECRET_KEY) : new MockSelfieCheck();
}

export function defaultEmail(config: Config): EmailSender {
  return config.emailMode === 'smtp'
    ? new SmtpEmailSender(config.EMAIL_FROM, { host: config.SMTP_HOST, port: config.SMTP_PORT, user: config.SMTP_USER, password: config.SMTP_PASSWORD })
    : new MemoryEmailSender();
}

export function defaultEmbeddings(config: Config): EmbeddingProvider {
  return config.assistantMode === 'vertex'
    ? new VertexEmbeddingProvider({ projectId: config.VERTEX_PROJECT_ID, location: config.EMBEDDING_LOCATION, model: config.EMBEDDING_MODEL })
    : new HashingEmbeddingProvider();
}

export function defaultAssistant(config: Config): ProfileAssistant {
  return config.assistantMode === 'vertex'
    ? new ClaudeVertexProfileAssistant({ projectId: config.VERTEX_PROJECT_ID, region: config.VERTEX_LOCATION })
    : new MockProfileAssistant();
}

/** M9 task drafter: Claude on Vertex when configured, otherwise the deterministic local mock. */
export function defaultDrafter(config: Config): TaskDrafter {
  return config.assistantMode === 'vertex' ? new ClaudeVertexTaskDrafter({ projectId: config.VERTEX_PROJECT_ID, region: config.VERTEX_LOCATION }) : new MockTaskDrafter();
}

export function defaultEvaluator(config: Config): SuitabilityEvaluator {
  return config.assistantMode === 'vertex'
    ? new ClaudeVertexSuitabilityEvaluator({ projectId: config.VERTEX_PROJECT_ID, region: config.VERTEX_LOCATION })
    : new MockSuitabilityEvaluator();
}

export function defaultStorage(config: Config): ObjectStorage {
  return new GcsStorage(config.EVIDENCE_BUCKET, config.GCS_EMULATOR_HOST ? { apiEndpoint: config.GCS_EMULATOR_HOST, projectId: config.GCS_PROJECT_ID } : {});
}

export function defaultGoogleVerifier(config: Config): GoogleVerifier {
  return config.candidateAuthMode === 'google' ? new GoogleIdTokenVerifier(config.GOOGLE_OAUTH_CLIENT_ID) : new MockGoogleVerifier(config.MOCK_SECRET);
}

export function defaultIdentityProvider(config: Config): IdentityProvider {
  return config.identityMode === 'stripe'
    ? new StripeIdentityProvider(config.STRIPE_SECRET_KEY, config.STRIPE_IDENTITY_WEBHOOK_SECRET)
    : new MockIdentityProvider(config.MOCK_SECRET, config.CANDIDATE_APP_URL);
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const storage = deps.storage ?? defaultStorage(deps.config);
  const selectionGate = deps.selectionGate ?? dbSelectionGate;
  const app = Fastify({
    logger: deps.logger ?? false,
    genReqId: (req) => {
      const incoming = req.headers['x-request-id'];
      return typeof incoming === 'string' && /^[\w-]{1,100}$/.test(incoming) ? incoming : randomUUID();
    },
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler((definition) => {
    const schema = definition.schema as unknown as z.ZodTypeAny;
    return validatorCompiler({ ...definition,
      schema: definition.httpPart === 'body' && schema instanceof z.ZodObject && schema._def.unknownKeys === 'strip'
        ? schema.strict() : schema,
    });
  });
  app.setSerializerCompiler(serializerCompiler);

  app.addHook('onSend', async (req, reply) => {
    reply.header('x-request-id', req.id);
  });

  app.setNotFoundHandler((req, reply) => reply.status(404).send({
    error: 'NOT_FOUND', message: 'This API route was not found.', requestId: String(req.id),
  }));
  app.addHook('onRequest', async (req) => {
    if (/%00/i.test(req.url) || req.url.includes('\0')) throw new AppError(400, 'INVALID_ADDRESS', 'This address contains an invalid character.');
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
    if (hasZodFastifySchemaValidationErrors(err)) {
      const fields = [...new Set(err.validation.flatMap((v) => v.params.issue.code === 'unrecognized_keys'
        ? v.params.issue.keys : v.params.issue.path.map(String)).filter((v) => /^[a-zA-Z0-9_.-]{1,60}$/.test(v)))].slice(0, 10);
      const unknown = err.validation.some((v) => v.params.issue.code === 'unrecognized_keys');
      const message = fields.length ? `${unknown ? 'Unknown fields' : 'Check these fields'}: ${fields.join(', ')}.` : 'Some values are invalid. Check the fields and try again.';
      return reply.status(400).send({ error: 'VALIDATION_FAILED', message, requestId, details: { fields } });
    }
    if (e.validation) {
      return reply.status(400).send({ error: 'VALIDATION_FAILED', message: 'Some values are invalid. Check the fields and try again.', requestId });
    }
    if (e.statusCode && e.statusCode < 500) {
      const code = e.statusCode === 413 ? 'REQUEST_TOO_LARGE' : e.statusCode === 429 ? 'RATE_LIMITED' : 'BAD_REQUEST';
      const message = e.statusCode === 413 ? 'This request is too large. Reduce its size and try again.' : e.statusCode === 429 ? 'Too many requests. Wait a minute and try again.' : 'This request could not be read. Check its contents and try again.';
      return reply.status(e.statusCode).send({ error: code, message, requestId });
    }
    req.log.error({ err }, 'unhandled error');
    return reply.status(500).send({ error: 'INTERNAL', message: 'Something went wrong', requestId });
  });

  await app.register(cookie);
  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 + 1, files: 1, fields: 5 } });
  await app.register(cors, {
    origin: deps.config.CORS_ORIGINS,
    credentials: true,
    allowedHeaders: ['content-type', 'idempotency-key', 'x-request-id'],
  });
  await app.register(rateLimit, { global: false });
  // Security headers on every API response (hardening before external testing, 27 Sep 2026). Responses are
  // personal, so they are never cached; /docs (Swagger UI) keeps its own scripts and is not given the strict CSP.
  app.addHook('onSend', async (req, reply) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('x-frame-options', 'DENY');
    reply.header('referrer-policy', 'no-referrer');
    if (deps.config.COOKIE_SECURE) reply.header('strict-transport-security', 'max-age=31536000; includeSubDomains');
    if (!req.url.startsWith('/docs')) {
      reply.header('content-security-policy', "default-src 'none'; frame-ancestors 'none'");
      if (!reply.hasHeader('cache-control')) reply.header('cache-control', 'no-store');
    }
  });
  await app.register(swagger, {
    openapi: {
      info: { title: 'ADI Praxis API', version: '0.1.0' },
      servers: [{ url: '/' }],
      components: {
        securitySchemes: {
          session: { type: 'apiKey', in: 'cookie', name: 'praxis_session' },
          candidateSession: { type: 'apiKey', in: 'cookie', name: 'praxis_candidate' },
          partnerSession: { type: 'apiKey', in: 'cookie', name: 'praxis_partner' },
          serviceToken: { type: 'http', scheme: 'bearer', bearerFormat: 'API key' },
          partnerOAuth: { type: 'oauth2', flows: { clientCredentials: { tokenUrl: '/partner/v1/oauth/token', scopes: { 'requisitions:read': 'Read requisitions', 'candidates:read': 'Read candidates and placements', 'candidates:write': 'Submit or withdraw candidates' } } } },
        },
      },
    },
    transform: jsonSchemaTransform,
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });
  await app.register(rbacPlugin, { db: deps.db });

  await app.register(healthRoutes, { db: deps.db, pingRedis: deps.pingRedis });
  await app.register(
    async (v1) => {
      // Which build is running (testers put this in defect reports). Set by the deploy; "local" otherwise.
      v1.get('/version', { config: { access: 'public' }, schema: { tags: ['health'] } }, async () => ({ build: process.env.PRAXIS_BUILD || 'local', commit: process.env.PRAXIS_COMMIT || null, env: deps.config.appEnv, ai: deps.config.assistantMode }));
      v1.get('/openapi.json', { config: { access: 'public' }, schema: { hide: true } }, async () => app.swagger());
      await v1.register(authRoutes, { db: deps.db, config: deps.config });
      await v1.register(userRoutes, { db: deps.db });
      await v1.register(templateRoutes, { db: deps.db });
      await v1.register(metaCompilerRoutes, { db: deps.db, config: deps.config });
      await v1.register(metaCompilerRunRoutes, { db: deps.db, config: deps.config, storage, drafters: deps.metaCompiler?.drafters ?? defaultDrafterFactory(deps.config), deps: resolveDeps(deps.metaCompiler?.deps), runner: deps.metaCompiler?.runner ?? defaultRunner(deps.config, storage) });
      await v1.register(taxonomyRoutes, { db: deps.db });
      await v1.register(jobDescriptionRoutes, { db: deps.db });
      await v1.register(projectRoutes, { db: deps.db });
      await v1.register(staffingRoutes, {
        db: deps.db,
        config: deps.config,
        geocoder: deps.geocoder ?? new OfflineGeocoder(),
        selectionGate,
      });
      await v1.register(candidateRoutes, { db: deps.db });
      await v1.register(opportunityRoutes, { db: deps.db, config: deps.config });
      await v1.register(campaignRoutes, { db: deps.db, config: deps.config });
      await v1.register(profileRoutes, {
        db: deps.db,
        requireLiveIdentity: deps.config.requireLiveIdentity,
        assistant: deps.assistant ?? defaultAssistant(deps.config),
        storage,
        scanner: deps.scanner ?? stubScanner,
      });
      await v1.register(reviewRoutes, { db: deps.db, evaluator: deps.evaluator ?? defaultEvaluator(deps.config), storage });
      await v1.register(journeyRoutes, { db: deps.db, config: deps.config, selectionGate });
      await v1.register(workRoutes, { db: deps.db, selectionGate, embeddings: deps.embeddings ?? defaultEmbeddings(deps.config) });
      await v1.register(taskReviewRoutes, { db: deps.db });
      await v1.register(draftingRoutes, { db: deps.db, storage, scanner: deps.scanner ?? stubScanner, selectionGate });
      // M10 SME supply: nothing is registered with the flag off (docs/SME-SUPPLY.md section 13).
      if (deps.config.SME_SUPPLY_ENABLED) {
        const email = deps.email ?? defaultEmail(deps.config);
        await v1.register(supplyInternalRoutes, { db: deps.db });
        await v1.register(partnerPortalRoutes, { db: deps.db, config: deps.config, email, box: secretBox(deps.config) });
        await v1.register(supplyCandidateRoutes, { db: deps.db, config: deps.config });
        const box = secretBox(deps.config);
        const gen = deps.curriculum ?? defaultCurriculum(deps.config);
        const embeddings = deps.embeddings ?? defaultEmbeddings(deps.config);
        await v1.register(certAdminRoutes, { db: deps.db, storage, box });
        const payouts = deps.payouts ?? defaultPayouts(deps.config);
        await v1.register(paymentRoutes, { db: deps.db, config: deps.config, payouts });
        await v1.register(paymentCandidateRoutes, { db: deps.db, payouts });
        await v1.register(certCandidateRoutes, { db: deps.db, config: deps.config, gen, box, embeddings, selfie: deps.selfie ?? defaultSelfie(deps.config), storage });
      }
      await v1.register(supportRoutes, { assistant: deps.support ?? defaultSupport(deps.config), partnerPortal: deps.config.SME_SUPPLY_ENABLED });
      await v1.register(datasetRoutes, { db: deps.db });
      await v1.register(rlRoutes, { db: deps.db });
      await v1.register(taskRoutes, { db: deps.db, config: deps.config, email: deps.email ?? defaultEmail(deps.config) });
      await v1.register(candidateAuthRoutes, {
        db: deps.db,
        config: deps.config,
        google: deps.google ?? defaultGoogleVerifier(deps.config),
        identity: deps.identity ?? defaultIdentityProvider(deps.config),
        resolveClientId:
          deps.resolveClientId ??
          (async () => {
            const byName = await deps.db.client.findFirst({ where: { name: process.env.SEED_CLIENT_NAME || 'ADI-Labs' } });
            const c = byName ?? (await deps.db.client.findFirst({ orderBy: { createdAt: 'asc' } }));
            if (!c) throw new Error('No client configured; run the seed');
            return c.id;
          }),
      });
    },
    { prefix: '/api/v1' },
  );

  // M10 Partner API v1 for partners' systems (OAuth2 client credentials), only with SME supply enabled.
  if (deps.config.SME_SUPPLY_ENABLED) {
    await app.register(partnerApiRoutes, { prefix: '/partner/v1', db: deps.db, config: deps.config, email: deps.email ?? defaultEmail(deps.config) });
  }

  return app;
}
