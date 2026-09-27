import type { KycStep, KycTask, KycToolResponse } from './kyc';

/**
 * KYC tools as MCP tools (docs/TASK-DRAFTING.md section 5). Each tool response an author writes is a recorded MCP
 * `tools/call`: the request (tool name and arguments valid against the tool's `inputSchema`) and the result the
 * environment returns. A task's recorded calls are enough to replay it on a standard MCP server.
 */
export const KYC_MCP_CATALOG_VERSION = 'kyc-tools/1';

interface ArgSpec {
  type: 'string';
  description: string;
  enum?: string[];
}
export interface McpToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, ArgSpec>;
    required?: string[];
    /** At least one of these groups must be complete (JSON Schema `anyOf` of `required`). */
    anyOf?: { required: string[] }[];
    additionalProperties: false;
  };
}

/** The argument a legacy free-text `input` maps to, per tool. */
export const MCP_PRIMARY_ARG: Record<string, string> = {
  document_check: 'documentId',
  registry_lookup: 'companyNumber',
  sanctions_pep_screening: 'name',
  adverse_media_search: 'name',
  address_check: 'address',
  risk_calculator: 'factors',
  request_info: 'request',
};

const str = (description: string, extra: Partial<ArgSpec> = {}): ArgSpec => ({ type: 'string', description, ...extra });

export const KYC_MCP_TOOLS: McpToolDefinition[] = [
  {
    name: 'document_check',
    title: 'Document check',
    description: 'Checks one document in the customer file for authenticity, validity and consistency, and returns what it found.',
    inputSchema: { type: 'object', properties: { documentId: str('Id of the document in the evidence set, e.g. D1'), check: str('What to check, e.g. expiry, name match, tampering') }, required: ['documentId'], additionalProperties: false },
  },
  {
    name: 'registry_lookup',
    title: 'Registry lookup',
    description: 'Looks up a company in the (synthetic) companies registry and returns its filings, officers and shareholders.',
    inputSchema: {
      type: 'object',
      properties: { companyNumber: str('Registry number, e.g. SYN-104233'), companyName: str('Registered name'), jurisdiction: str('Country code, e.g. GB') },
      anyOf: [{ required: ['companyNumber'] }, { required: ['companyName'] }],
      additionalProperties: false,
    },
  },
  {
    name: 'sanctions_pep_screening',
    title: 'Sanctions / PEP screening',
    description: 'Screens a person or entity against sanctions and politically exposed person lists, returning hits and near matches.',
    inputSchema: { type: 'object', properties: { name: str('Full name of the person or entity'), dateOfBirth: str('YYYY-MM-DD, for people'), nationality: str('Country code') }, required: ['name'], additionalProperties: false },
  },
  {
    name: 'adverse_media_search',
    title: 'Adverse media search',
    description: 'Searches (synthetic) news and media for negative coverage of a person or entity.',
    inputSchema: { type: 'object', properties: { name: str('Full name of the person or entity'), keywords: str('Optional extra terms, e.g. fraud; bribery') }, required: ['name'], additionalProperties: false },
  },
  {
    name: 'address_check',
    title: 'Address check',
    description: 'Verifies that an address exists and what kind of property it is (residential, commercial, virtual office).',
    inputSchema: { type: 'object', properties: { address: str('The address as given'), partyId: str('Party the address belongs to, e.g. P1') }, required: ['address'], additionalProperties: false },
  },
  {
    name: 'risk_calculator',
    title: 'Risk calculator',
    description: 'Scores customer risk from the factors given and returns a score and a band.',
    inputSchema: { type: 'object', properties: { factors: str('Risk factors, separated by semicolons'), customerType: str('e.g. individual, corporate') }, required: ['factors'], additionalProperties: false },
  },
  {
    name: 'request_info',
    title: 'Request information from customer',
    description: 'Sends a request for information or documents to the customer and returns the reply, if any.',
    inputSchema: { type: 'object', properties: { request: str('What is asked for'), partyId: str('Who it is asked of, e.g. P1') }, required: ['request'], additionalProperties: false },
  },
];

export const mcpTool = (name: string) => KYC_MCP_TOOLS.find((t) => t.name === name);

export type McpArguments = Record<string, string>;

/** Arguments without empty values, trimmed. */
function clean(args: Record<string, unknown>): McpArguments {
  return Object.fromEntries(
    Object.entries(args)
      .filter(([, v]) => typeof v === 'string' && v.trim() !== '')
      .map(([k, v]) => [k, (v as string).trim()]),
  );
}

/** Stable text form of arguments, used to match a call during replay (key order and whitespace do not matter). */
export function canonicalArgs(args: Record<string, unknown>): string {
  const c = clean(args);
  return JSON.stringify(Object.keys(c).sort().map((k) => [k, c[k]]));
}

/** Why `args` are not valid for the tool's `inputSchema` (empty when valid). */
export function argumentProblems(toolName: string, args: Record<string, unknown> | undefined): string[] {
  const tool = mcpTool(toolName);
  if (!tool) return [`${toolName || 'The tool'} is not in the MCP catalog`];
  const raw = args ?? {};
  const out: string[] = [];
  for (const [k, v] of Object.entries(raw)) {
    if (!tool.inputSchema.properties[k]) out.push(`${tool.name} has no argument “${k}”`);
    else if (v !== undefined && v !== null && typeof v !== 'string') out.push(`${tool.name}.${k} must be text`);
  }
  const a = clean(raw);
  for (const r of tool.inputSchema.required ?? []) if (!a[r]) out.push(`${tool.name} needs “${r}”`);
  if (tool.inputSchema.anyOf && !tool.inputSchema.anyOf.some((g) => g.required.every((r) => a[r]))) {
    out.push(`${tool.name} needs one of: ${tool.inputSchema.anyOf.map((g) => g.required.join(' + ')).join(', ')}`);
  }
  for (const [k, v] of Object.entries(a)) {
    const e = tool.inputSchema.properties[k]?.enum;
    if (e && !e.includes(v)) out.push(`${tool.name}.${k} must be one of ${e.join(', ')}`);
  }
  return out;
}

/** A response's arguments. Tasks written before M9 have only a free-text `input`, which becomes the main argument. */
export function responseArguments(r: Pick<KycToolResponse, 'tool' | 'input' | 'arguments'>): McpArguments {
  if (r.arguments && Object.keys(clean(r.arguments)).length) return clean(r.arguments);
  const key = MCP_PRIMARY_ARG[r.tool];
  return key && r.input?.trim() ? { [key]: r.input.trim() } : {};
}

/** A short human-readable form of arguments, kept in `input` for older readers and lists. */
export const argumentsSummary = (args: McpArguments) => Object.values(args).join(' · ');

/** A step's arguments: its own when given, otherwise those of the call it points at. */
export function stepArguments(s: KycStep, response: KycToolResponse | undefined): McpArguments | null {
  if (s.arguments && Object.keys(clean(s.arguments)).length) return clean(s.arguments);
  return response ? responseArguments(response) : null;
}

export interface RecordedMcpCall {
  id: string;
  request: { method: 'tools/call'; params: { name: string; arguments: McpArguments } };
  result: { content: { type: 'text'; text: string }[]; isError: boolean };
  kind: string;
}

export function toMcpCall(r: KycToolResponse): RecordedMcpCall {
  return {
    id: r.id,
    request: { method: 'tools/call', params: { name: r.tool, arguments: responseArguments(r) } },
    result: { content: [{ type: 'text', text: r.response }], isError: r.kind === 'ERROR' },
    kind: r.kind,
  };
}

/** Everything needed to replay a task's environment: the tools it offers and the recorded calls. */
export interface ReplayBundle {
  catalogVersion: string;
  tools: Omit<McpToolDefinition, 'title'>[];
  calls: RecordedMcpCall[];
}

export function replayBundle(t: KycTask): ReplayBundle {
  const offered = new Set(t.environment?.tools ?? []);
  return {
    catalogVersion: KYC_MCP_CATALOG_VERSION,
    tools: KYC_MCP_TOOLS.filter((x) => offered.has(x.name)).map(({ title: _title, ...rest }) => rest),
    calls: (t.environment?.responses ?? []).map(toMcpCall),
  };
}

/** Answers a `tools/call` from a bundle: the recorded result for matching arguments, or an error result. */
export function replayCall(bundle: ReplayBundle, name: string, args: Record<string, unknown>): RecordedMcpCall['result'] {
  if (!bundle.tools.some((t) => t.name === name)) return { content: [{ type: 'text', text: `Tool ${name} is not available in this task.` }], isError: true };
  const want = canonicalArgs(args);
  const hit = bundle.calls.find((c) => c.request.params.name === name && canonicalArgs(c.request.params.arguments) === want);
  return hit ? hit.result : { content: [{ type: 'text', text: 'No recorded response for these arguments.' }], isError: true };
}
