import 'server-only';

/**
 * M10 (docs/SME-SUPPLY.md): the SME supply screens exist only when `SME_SUPPLY_ENABLED` is on, the same switch the API
 * uses. With it off no M10 menu item is shown, and the API answers 404 for every M10 route.
 */
export function smeSupplyEnabled(): boolean {
  const v = process.env.SME_SUPPLY_ENABLED ?? '';
  return v === 'true' || v === '1';
}
