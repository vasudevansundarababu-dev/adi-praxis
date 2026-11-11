import { Prisma } from '@prisma/client';
import type { InternalActor } from '../auth/actor';
import type { Db } from '../db';
import { sha256 } from '../lib/crypto';
import type { EmbeddingProvider } from '../tasks/embeddings';
import { SEARCH_SOURCES, type SearchRow, type SearchType } from './sources';

/**
 * Search bar for the console lists (owner, 12 Nov 2026). Hybrid:
 *  - by letters: typo-tolerant trigram matching (pg_trgm) plus prefix matching, so 2–3 letters already find a record;
 *  - by meaning: from 4 characters, the query and each record's professional text are embedded (Vertex in QA and
 *    production, the hashing stand-in locally) and ranked by cosine similarity.
 * Results are limited to what the actor can already see in that list. Ranking only: no decision is made from it.
 */
export const SEMANTIC_MIN_CHARS = 4;
/** Typo-tolerant (trigram-only) matches need this score and at least TYPO_MIN_CHARS characters: on 2–4 letters a
 * near-miss ("kyb" vs "kyc") scores like a real typo, so short queries match by prefix and substring only. */
export const LEXICAL_MIN = 0.5;
export const TYPO_MIN_CHARS = 5;
export const SEMANTIC_MIN = 0.6;
/** Records embedded per request; the rest follow on later searches (letters still work meanwhile). */
export const EMBED_BATCH = 20;

export interface SearchHit {
  id: string;
  title: string;
  subtitle: string;
  href: string;
  score: number;
  /** Why it matched: by letters, by meaning, or both. */
  match: 'letters' | 'meaning' | 'both';
}

export interface SearchResult {
  items: SearchHit[];
  /** Every matching id (for filtering the table), best first. */
  ids: string[];
  semantic: 'used' | 'short_query' | 'unavailable';
}

const vectorLiteral = (v: number[]) => `[${v.map((x) => (Number.isFinite(x) ? x : 0)).join(',')}]`;
const words = (s: string) => s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/** Letters score for one row: exact substring or word prefix scores high; otherwise the trigram word similarity. */
export function lettersScore(q: string, row: Pick<SearchRow, 'title' | 'text'>, trigram: number): number {
  const query = q.trim().toLowerCase();
  if (!query) return 0;
  const title = row.title.toLowerCase();
  if (title.startsWith(query)) return 1;
  const qWords = words(query);
  const titleWords = words(title);
  const textWords = words(row.text);
  // Every query word starts some word of the title (or of the text): "kyc on" -> "KYC onboarding".
  if (qWords.length && qWords.every((w) => titleWords.some((t) => t.startsWith(w)))) return 0.95;
  if (row.text.toLowerCase().includes(query)) return 0.85;
  if (qWords.length && qWords.every((w) => textWords.some((t) => t.startsWith(w)))) return 0.8;
  return query.length >= TYPO_MIN_CHARS ? trigram : 0;
}

export class SearchService {
  private readonly queryCache = new Map<string, number[]>();
  constructor(
    private readonly db: Db,
    private readonly embeddings: EmbeddingProvider | null,
  ) {}

  /** Keeps the index in step with the rows (text and meaning hash); a changed meaning clears its embedding. */
  private async sync(type: SearchType, clientId: string, rows: SearchRow[]) {
    if (!rows.length) return;
    const docs = await this.db.searchDocument.findMany({ where: { entityType: type, entityId: { in: rows.map((r) => r.id) } } });
    const byId = new Map(docs.map((d) => [d.entityId, d]));
    for (const r of rows) {
      const hash = sha256(r.meaning);
      const d = byId.get(r.id);
      if (d && d.text === r.text && d.meaningHash === hash) continue;
      // Two searches may index the same record at once; the loser's write is redundant.
      await this.db.searchDocument
        .upsert({
        where: { entityType_entityId: { entityType: type, entityId: r.id } },
        create: { clientId, entityType: type, entityId: r.id, text: r.text, meaningHash: hash, sourceUpdatedAt: r.updatedAt },
          update: { text: r.text, meaningHash: hash, sourceUpdatedAt: r.updatedAt, ...(d?.meaningHash !== hash ? { embeddingModel: null } : {}) },
        })
        .catch((e: unknown) => {
          if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
        });
      if (d && d.meaningHash !== hash) await this.db.$executeRaw`UPDATE "SearchDocument" SET embedding = NULL WHERE id = ${d.id}::uuid`;
    }
  }

  /** Embeds up to EMBED_BATCH records that have meaning text but no embedding from the current model. */
  private async embedPending(type: SearchType, rows: SearchRow[]) {
    const model = this.embeddings!.model;
    const meaning = new Map(rows.filter((r) => r.meaning.trim()).map((r) => [r.id, r.meaning]));
    if (!meaning.size) return;
    const pending = await this.db.searchDocument.findMany({
      where: { entityType: type, entityId: { in: [...meaning.keys()] }, OR: [{ embeddingModel: null }, { embeddingModel: { not: model } }] },
      take: EMBED_BATCH,
      select: { id: true, entityId: true },
    });
    for (const p of pending) {
      const v = await this.embeddings!.embed(meaning.get(p.entityId)!);
      await this.db.$executeRaw`UPDATE "SearchDocument" SET embedding = ${vectorLiteral(v)}::vector, embedding_model = ${model} WHERE id = ${p.id}::uuid`;
    }
  }

  private async embedQuery(q: string) {
    const key = q.trim().toLowerCase();
    const hit = this.queryCache.get(key);
    if (hit) return hit;
    const v = await this.embeddings!.embed(key);
    if (this.queryCache.size > 500) this.queryCache.delete(this.queryCache.keys().next().value!);
    this.queryCache.set(key, v);
    return v;
  }

  async search(actor: InternalActor, type: SearchType, q: string, limit = 8): Promise<SearchResult> {
    const query = q.trim().slice(0, 200);
    const rows = await SEARCH_SOURCES[type].visible(this.db, actor);
    if (!query) return { items: [], ids: [], semantic: 'short_query' };
    await this.sync(type, actor.clientId, rows);

    let semantic: SearchResult['semantic'] = query.length < SEMANTIC_MIN_CHARS ? 'short_query' : this.embeddings ? 'used' : 'unavailable';
    let qVec: number[] | null = null;
    if (semantic === 'used') {
      try {
        await this.embedPending(type, rows);
        qVec = await this.embedQuery(query);
      } catch {
        // The embedding model is down: letters still work.
        semantic = 'unavailable';
      }
    }

    const ids = rows.map((r) => r.id);
    const model = this.embeddings?.model ?? '';
    const scored = await this.db.$queryRaw<{ entity_id: string; tri: number; sem: number | null }[]>(Prisma.sql`
      SELECT entity_id::text,
             GREATEST(word_similarity(${query.toLowerCase()}, lower(text)), similarity(${query.toLowerCase()}, lower(text)))::float8 AS tri,
             ${qVec ? Prisma.sql`CASE WHEN embedding IS NOT NULL AND embedding_model = ${model} THEN (1 - (embedding <=> ${vectorLiteral(qVec)}::vector))::float8 END` : Prisma.sql`NULL::float8`} AS sem
      FROM "SearchDocument"
      WHERE entity_type = ${type} AND entity_id = ANY(${ids}::uuid[])`);
    const byId = new Map(rows.map((r) => [r.id, r]));
    const hits: SearchHit[] = [];
    for (const s of scored) {
      const row = byId.get(s.entity_id);
      if (!row) continue;
      const letters = lettersScore(query, row, Number(s.tri));
      const meaning = s.sem === null ? null : Number(s.sem);
      const byLetters = letters >= LEXICAL_MIN;
      const byMeaning = meaning !== null && meaning >= SEMANTIC_MIN;
      if (!byLetters && !byMeaning) continue;
      const score = meaning === null ? letters : Math.max(letters, 0.6 * letters + 0.4 * meaning, byMeaning ? 0.5 * meaning : 0);
      hits.push({ id: row.id, title: row.title, subtitle: row.subtitle, href: row.href, score: Math.round(score * 1000) / 1000, match: byLetters && byMeaning ? 'both' : byLetters ? 'letters' : 'meaning' });
    }
    hits.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
    return { items: hits.slice(0, limit), ids: hits.map((h) => h.id), semantic };
  }
}
