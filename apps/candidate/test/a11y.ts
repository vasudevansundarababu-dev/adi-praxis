/**
 * Static accessibility checks on server-rendered markup (NFR-10). The repository has no axe-core or DOM library,
 * so this covers the axe rules that can be decided from markup alone: control labels, button and link names, image
 * alt text, duplicate ids, dangling aria/label references and positive tabindex. Keep in sync with
 * apps/web/test/a11y.ts.
 */

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const TOKEN = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][\w-]*)((?:\s+[^\s=>/]+(?:=(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|([^<]+)/g;
const ATTR = /([^\s=>/]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;

type Attrs = Record<string, string>;
interface Open {
  tag: string;
  attrs: Attrs;
  text: string;
}

function parseAttrs(s: string): Attrs {
  const out: Attrs = {};
  for (const m of s.matchAll(ATTR)) out[m[1]!.toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? '';
  return out;
}

const describe = (tag: string, a: Attrs) => `<${tag}${a.id ? ` id="${a.id}"` : ''}${a.name ? ` name="${a.name}"` : ''}${a.type ? ` type="${a.type}"` : ''}>`;

export function a11yProblems(markup: string): string[] {
  const problems: string[] = [];
  const ids = new Map<string, number>();
  const labelFor = new Set<string>();
  const refs: Array<[string, string]> = [];
  const controls: Array<{ tag: string; attrs: Attrs; inLabel: boolean }> = [];
  const stack: Open[] = [];

  const close = (el: Open) => {
    const named = el.text.trim() || el.attrs['aria-label']?.trim() || el.attrs['aria-labelledby'];
    if (el.tag === 'button' && !named) problems.push(`button without an accessible name: ${describe(el.tag, el.attrs)}`);
    if (el.tag === 'a' && 'href' in el.attrs && !named) problems.push(`link without an accessible name: href="${el.attrs.href}"`);
  };

  for (const m of markup.matchAll(TOKEN)) {
    if (m[5] !== undefined) {
      for (const el of stack) el.text += m[5];
      continue;
    }
    if (!m[2]) continue;
    const tag = m[2].toLowerCase();
    if (m[1]) {
      const i = stack.map((e) => e.tag).lastIndexOf(tag);
      if (i >= 0) for (const el of stack.splice(i).reverse()) close(el);
      continue;
    }
    const attrs = parseAttrs(m[3] ?? '');
    if (attrs.id) ids.set(attrs.id, (ids.get(attrs.id) ?? 0) + 1);
    if (tag === 'label' && attrs.for) labelFor.add(attrs.for);
    for (const k of ['aria-labelledby', 'aria-describedby', 'aria-controls']) for (const id of (attrs[k] ?? '').split(/\s+/).filter(Boolean)) refs.push([k, id]);
    if (Number(attrs.tabindex) > 0) problems.push(`positive tabindex on ${describe(tag, attrs)}`);
    if (tag === 'img') {
      if (!('alt' in attrs)) problems.push(`img without alt: src="${attrs.src ?? ''}"`);
      for (const el of stack) el.text += attrs.alt ?? '';
    }
    const isControl = (tag === 'input' && attrs.type !== 'hidden') || tag === 'select' || tag === 'textarea';
    if (isControl) controls.push({ tag, attrs, inLabel: stack.some((e) => e.tag === 'label') });
    if (!VOID.has(tag) && !m[4]) stack.push({ tag, attrs, text: '' });
  }
  for (const el of stack.reverse()) close(el);

  for (const c of controls) {
    const a = c.attrs;
    if (c.inLabel || a['aria-label']?.trim() || a['aria-labelledby'] || (a.id && labelFor.has(a.id)) || a.title?.trim()) continue;
    problems.push(`form control without a label: ${describe(c.tag, a)}`);
  }
  for (const [id, n] of ids) if (n > 1) problems.push(`duplicate id "${id}" (${n} times)`);
  for (const id of labelFor) if (!ids.has(id)) problems.push(`label for="${id}" points at no element`);
  for (const [k, id] of refs) if (!ids.has(id)) problems.push(`${k}="${id}" points at no element`);
  return problems;
}
