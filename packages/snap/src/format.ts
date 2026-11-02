import type { ExposureResult, SanctionsResult, ScoreResult } from './types';

/**
 * Human label for a score range as the API spells it.
 *
 * @param range - `excellent` … `low`, or anything else.
 * @returns The label, or an empty string for unknown input.
 */
export function rangeLabel(range: string | null | undefined): string {
  switch (range) {
    case 'excellent':
      return 'Excellent';
    case 'very_good':
      return 'Very good';
    case 'good':
      return 'Good';
    case 'fair':
      return 'Fair';
    case 'low':
      return 'Low';
    case null:
    case undefined:
    case '':
      return '';
    default:
      return range.replace(/_/gu, ' ');
  }
}

/**
 * "742 · Good" style summary of a score.
 *
 * @param score - A score response.
 * @returns A one-line summary, or "No score" when the wallet has none.
 */
export function scoreSummary(score: ScoreResult): string {
  if (typeof score.score !== 'number') {
    return 'No score';
  }
  const rounded = Math.round(score.score);
  const label = rangeLabel(score.range);
  return label ? `${rounded} · ${label}` : `${rounded}`;
}

/**
 * Names of the sanctions-list entries that matched, de-duplicated.
 *
 * @param sanctions - A screening response.
 * @returns E.g. "TORNADO CASH (CYBER2)".
 */
export function sanctionsSummary(sanctions: SanctionsResult): string {
  const parts = new Set<string>();
  for (const match of sanctions.matches) {
    const name = match.entityName ?? match.source;
    parts.add(match.programs ? `${name} (${match.programs})` : name);
  }
  return [...parts].join(', ');
}

/**
 * One line describing a wallet's sanctions exposure beyond its own listing.
 *
 * @param exposure - An exposure response.
 * @returns E.g. "Funded by TORNADO CASH" or "Dealt with 2 sanctioned
 * addresses, last in Jun 2026"; "None found" when clean; a note when the
 * history could not be read.
 */
export function exposureSummary(exposure: ExposureResult): string {
  const funding = exposure.fundingSource;
  if (funding?.sanctioned) {
    return `Funded by ${funding.entityName ?? shortAddress(funding.address)}`;
  }
  const hits = exposure.sanctionedCounterparties;
  if (hits.length > 0) {
    const names = [
      ...new Set(
        hits.map((hit) => hit.entityName ?? shortAddress(hit.address)),
      ),
    ];
    const who =
      names.length <= 2
        ? names.join(' and ')
        : `${hits.length} sanctioned addresses`;
    const last = hits
      .map((hit) => hit.lastSeen)
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1);
    return last
      ? `Dealt with ${who}, last ${monthYear(last)}`
      : `Dealt with ${who}`;
  }
  if (exposure.coverage === 'unavailable') {
    return 'History unavailable right now';
  }
  return exposure.coverage === 'partial'
    ? 'None found in recent history'
    : 'None found';
}

/**
 * "Jun 2026" from an ISO timestamp; the raw string when it will not parse.
 *
 * @param iso - An ISO 8601 timestamp.
 * @returns A short month and year.
 */
function monthYear(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return date.toLocaleString('en-US', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/**
 * Shorten an address for labels: 0x1234…abcd.
 *
 * @param address - A hex address.
 * @returns The shortened form.
 */
export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}
