import type { Db } from '../db';
import { applyCatalogV2, reverseCatalogV2, type CatalogPlan } from '../../prisma/catalog/catalog-v2';

/**
 * `run.ts catalog-v2 [--dry-run] [--reverse] [--client <name>]` (AD-07): the D15/D15a catalog change for every client,
 * or only the named one. A dry run writes nothing and logs the plan the same command would apply.
 */
export interface CatalogV2Args {
  dryRun: boolean;
  reverse: boolean;
  clientName: string | null;
}

export function parseCatalogV2Args(argv: string[]): CatalogV2Args {
  const args: CatalogV2Args = { dryRun: false, reverse: false, clientName: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--reverse') args.reverse = true;
    else if (a === '--client' && argv[i + 1]) args.clientName = argv[++i]!;
    else throw new Error(`Unknown catalog-v2 argument "${a}". Use: --dry-run | --reverse | --client <name>`);
  }
  return args;
}

type Log = (level: string, message: string, extra?: object) => void;

export async function runCatalogV2(db: Db, args: CatalogV2Args, log: Log): Promise<CatalogPlan[]> {
  const clients = await db.client.findMany({ where: args.clientName ? { name: args.clientName } : {}, orderBy: { createdAt: 'asc' } });
  if (args.clientName && clients.length === 0) throw new Error(`Client "${args.clientName}" not found`);
  const plans: CatalogPlan[] = [];
  for (const client of clients) {
    const plan = await (args.reverse ? reverseCatalogV2 : applyCatalogV2)(db, client.id, { apply: !args.dryRun });
    plans.push(plan);
    const counts: Record<string, number> = {};
    for (const c of plan.changes) counts[c.action] = (counts[c.action] ?? 0) + 1;
    log('info', `catalog-v2${args.reverse ? ' reverse' : ''}${args.dryRun ? ' dry run' : ''}: ${plan.changes.length} change(s)`, {
      client: client.name,
      clientId: client.id,
      applied: plan.applied,
      counts,
      changes: plan.changes.map((c) => `${c.action} ${c.domain}${c.workflowName ? ` / ${c.workflowName}` : ''}${c.version ? ` v${c.version}` : ''}: ${c.from ?? '(new)'} -> ${c.to}`),
      notes: plan.notes.map((n) => `${n.kind} ${n.domain}${n.workflowName ? ` / ${n.workflowName}` : ''}${n.version ? ` v${n.version}` : ''} (${n.status}): ${n.detail}`),
    });
  }
  return plans;
}
