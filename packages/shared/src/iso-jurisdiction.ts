/**
 * Real ISO 3166 jurisdictions for the policy library (D-090, owner 26 Nov 2026). The C1 format check alone
 * (`ISO_JURISDICTION`: two letters, optionally a dash and up to three more) let "US-A" through. This checks the code
 * itself: an ISO 3166-1 alpha-2 country, or an ISO 3166-2 subdivision of a country whose subdivisions are listed here
 * (the United States, and Canada). Another country's subdivision is refused with a plain reason, never guessed.
 */

/** ISO 3166-1 alpha-2 (officially assigned codes). */
export const ISO_3166_1_ALPHA2: readonly string[] = (
  'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD ' +
  'CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF ' +
  'GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN ' +
  'KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA ' +
  'NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI ' +
  'SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI ' +
  'VN VU WF WS YE YT ZA ZM ZW'
).split(' ');

/** ISO 3166-2:US: the 50 states, the District of Columbia and the outlying areas. */
export const ISO_3166_2_US: readonly string[] = (
  'AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC ' +
  'SD TN TX UT VT VA WA WV WI WY DC AS GU MP PR UM VI'
).split(' ');

/** ISO 3166-2:CA: the provinces and territories of Canada. */
export const ISO_3166_2_CA: readonly string[] = 'AB BC MB NB NL NS NT NU ON PE QC SK YT'.split(' ');

const SUBDIVISIONS: Record<string, readonly string[]> = { US: ISO_3166_2_US, CA: ISO_3166_2_CA };

/** Why a jurisdiction is not a real ISO 3166 code, in plain words; null when it is one. */
export function jurisdictionProblem(code: string | null | undefined): string | null {
  const c = (code ?? '').trim();
  if (!c) return 'No jurisdiction.';
  const m = /^([A-Z]{2})(?:-([A-Z0-9]{1,3}))?$/.exec(c);
  if (!m) return `"${c}" is not an ISO code. Use a country such as US, or a state such as US-CA.`;
  const country = m[1]!;
  const sub = m[2];
  if (!ISO_3166_1_ALPHA2.includes(country)) return `"${country}" is not an ISO 3166 country code.`;
  if (sub === undefined) return null;
  const known = SUBDIVISIONS[country];
  if (!known) return `Subdivisions are checked for the US and Canada only. Use the country code ${country}.`;
  if (!known.includes(sub)) return `"${c}" is not an ISO 3166-2 subdivision of ${country}${country === 'US' ? ' (for example US-CA for California)' : ''}.`;
  return null;
}

/** True for a real ISO 3166 country, or a US or Canadian subdivision (US, US-CA, CA-ON). */
export const isIsoJurisdiction = (code: string | null | undefined) => jurisdictionProblem(code) === null;
