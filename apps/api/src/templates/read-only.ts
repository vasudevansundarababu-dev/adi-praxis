/**
 * D-024 (owner, 23 Nov 2026): templates come only from Studio releases; Authoring views and publishes them, never edits
 * them. These routes create or change a template (the old in-Authoring editor and template builder) and are refused
 * unless TEMPLATE_EDITING_ENABLED is set. Still open: viewing, Publish and Retire, tutorial videos (SME help, not template
 * content), and Studio's own proposal route (/integrations/anvil/templates/proposals), which is how releases arrive.
 */
const CLOSED: [string, RegExp][] = [
  ['POST', /^\/api\/v1\/templates\/?$/],
  ['PATCH', /^\/api\/v1\/templates\/[^/]+\/?$/],
  ['POST', /^\/api\/v1\/templates\/[^/]+\/versions\/?$/],
  ['PUT', /^\/api\/v1\/templates\/[^/]+\/blueprint\/?$/],
  ['POST', /^\/api\/v1\/templates\/[^/]+\/variant\/?$/],
  ['PUT', /^\/api\/v1\/templates\/[^/]+\/uispec\/?$/],
  ['POST', /^\/api\/v1\/templates\/[^/]+\/assistant\/propose-field\/?$/],
  ['POST', /^\/api\/v1\/templates\/[^/]+\/generations\/?$/],
  ['POST', /^\/api\/v1\/templates\/[^/]+\/deployments\/?$/],
  ['POST', /^\/api\/v1\/generations\/[^/]+\/verifications\/?$/],
  ['PUT', /^\/api\/v1\/domains\/[^/]+\/presets\/?$/],
  // Uploading authoring forms and golden packs (creates forms and draft templates). /template-profiles/check stays (read-only).
  ['POST', /^\/api\/v1\/template-profiles\/?$/],
];

export const TEMPLATE_READ_ONLY_MESSAGE = 'Templates come from Studio releases. In Authoring you can view a template and publish or retire a version; to change it, ask Studio for a new release.';

export function templateEditClosed(method: string, url: string): boolean {
  const path = url.split('?')[0] ?? url;
  return CLOSED.some(([m, re]) => m === method.toUpperCase() && re.test(path));
}
