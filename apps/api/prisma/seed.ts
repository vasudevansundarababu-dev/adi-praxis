import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/auth/password';

/**
 * Local/staging seed (synthetic data only). Safe to run repeatedly.
 * - the single v1 client
 * - the first Admin user (credentials from SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD)
 * - FLOW 4 failure reason codes (SPEC: "seeded, Admin-editable")
 * The template catalog from Taskflow.xlsx is seeded in M1.
 */
export const FAILURE_REASON_CODES = [
  ['WRONG_ANSWER', 'Wrong answer'],
  ['UNSUPPORTED_CLAIM', 'Unsupported claim'],
  ['POLICY_BREACH', 'Policy breach'],
  ['UNSAFE_ACTION', 'Unsafe action'],
  ['INCOMPLETE', 'Incomplete'],
  ['TOOL_MISUSE', 'Tool misuse'],
  ['OTHER', 'Other'],
] as const;

export async function seed(db: PrismaClient, env: NodeJS.ProcessEnv = process.env) {
  const clientName = env.SEED_CLIENT_NAME || 'ADI-Labs';
  const adminEmail = (env.SEED_ADMIN_EMAIL || '').trim().toLowerCase();
  const adminPassword = env.SEED_ADMIN_PASSWORD || '';
  if (!adminEmail || adminPassword.length < 12) {
    throw new Error('Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD (min 12 characters) to seed the first Admin');
  }

  const client = await db.client.upsert({ where: { name: clientName }, update: {}, create: { name: clientName } });

  const admin = await db.user.upsert({
    where: { email: adminEmail },
    update: {},
    create: {
      clientId: client.id,
      email: adminEmail,
      name: 'Platform Admin',
      roles: ['ADMIN'],
      passwordHash: await hashPassword(adminPassword),
    },
  });

  for (const [code, label] of FAILURE_REASON_CODES) {
    await db.failureReasonCode.upsert({
      where: { clientId_code: { clientId: client.id, code } },
      update: {},
      create: { clientId: client.id, code, label },
    });
  }

  return { client, admin };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const db = new PrismaClient();
  seed(db)
    .then(({ client, admin }) => console.log(`Seeded client "${client.name}" and admin ${admin.email}`))
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => db.$disconnect());
}
