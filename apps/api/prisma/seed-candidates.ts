import { PrismaClient } from '@prisma/client';

/**
 * LOCAL DEV ONLY: synthetic candidates for exercising FLOW 2 matching before the real candidate flow (M4).
 * Every record is invented and named "Test Expert NNN". Refuses to run in production. Safe to re-run.
 */
export const SYNTHETIC_PREFIX = 'Test Expert';

const CITIES: [string, string, number, number, string][] = [
  ['London', 'GB', 51.5074, -0.1278, 'Europe/London'],
  ['Manchester', 'GB', 53.4808, -2.2426, 'Europe/London'],
  ['Edinburgh', 'GB', 55.9533, -3.1883, 'Europe/London'],
  ['Dublin', 'IE', 53.3498, -6.2603, 'Europe/Dublin'],
  ['Mumbai', 'IN', 19.076, 72.8777, 'Asia/Kolkata'],
  ['Bengaluru', 'IN', 12.9716, 77.5946, 'Asia/Kolkata'],
  ['Singapore', 'SG', 1.3521, 103.8198, 'Asia/Singapore'],
  ['New York', 'US', 40.7128, -74.006, 'America/New_York'],
  ['Dubai', 'AE', 25.2048, 55.2708, 'Asia/Dubai'],
  ['Johannesburg', 'ZA', -26.2041, 28.0473, 'Africa/Johannesburg'],
];
const SPECIALTIES = [['KYC'], ['KYC', 'EDD'], ['EDD'], ['AML'], ['Sanctions'], ['KYB'], ['Transaction monitoring'], ['Adverse media'], ['KYC', 'AML']];
const SKILLS = ['KYC', 'EDD', 'AML', 'Sanctions', 'KYB', 'PEP screening', 'Risk rating', 'SAR drafting'];
const LEVELS = ['B2', 'C1', 'C2', 'NATIVE'];
const EDUCATION = ['ISCED_5', 'ISCED_6', 'ISCED_7', 'ISCED_8'];

/** Small deterministic PRNG (mulberry32) so the seed is reproducible. */
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export async function seedCandidates(db: PrismaClient, clientId: string, count = 200) {
  if (process.env.NODE_ENV === 'production') throw new Error('Synthetic candidates are for local development only');
  const existing = await db.smeUser.count({ where: { clientId, displayName: { startsWith: SYNTHETIC_PREFIX } } });
  if (existing >= count) return { created: 0, existing };

  const rand = rng(20260926);
  const pick = <T>(xs: T[]) => xs[Math.floor(rand() * xs.length)]!;
  let created = 0;
  for (let i = existing + 1; i <= count; i++) {
    const [city, country, lat, lng, tz] = pick(CITIES);
    // ~1 in 10 still has identity pending, so the matcher's identity gate is visible in the list.
    const sme = await db.smeUser.create({
      data: {
        clientId,
        displayName: `${SYNTHETIC_PREFIX} ${String(i).padStart(3, '0')}`,
        accountStatus: 'ACTIVE',
        identityStatus: rand() < 0.1 ? 'PROCESSING' : 'VERIFIED',
        adultAttestedAt: new Date(),
      },
    });
    const languages = [{ language: 'en', level: pick(LEVELS) }];
    if (country === 'IN') languages.push({ language: 'hi', level: 'NATIVE' });
    if (country === 'AE') languages.push({ language: 'ar', level: pick(LEVELS) });
    await db.candidate.create({
      data: {
        clientId,
        smeUserId: sme.id,
        country,
        city,
        latitude: lat,
        longitude: lng,
        timezone: tz,
        languages,
        specialties: pick(SPECIALTIES),
        skills: SKILLS.filter(() => rand() < 0.4),
        jurisdictions: [country],
        domainExperienceYears: Math.round(rand() * 20 * 10) / 10,
        educationLevel: pick(EDUCATION),
        hoursPerWeek: 5 + Math.floor(rand() * 36),
        lastValidatedAt: new Date(Date.now() - Math.floor(rand() * 90) * 86_400_000),
      },
    });
    created += 1;
  }
  return { created, existing };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const db = new PrismaClient();
  (async () => {
    const client = await db.client.findFirst({ where: { name: process.env.SEED_CLIENT_NAME || 'ADI-Labs' } });
    if (!client) throw new Error('Run pnpm db:seed first');
    const r = await seedCandidates(db, client.id);
    console.log(`Synthetic candidates: ${r.created} created, ${r.existing} already present`);
  })()
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => db.$disconnect());
}
