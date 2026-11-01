import type { SanctionsResult, ScoreResult } from './types';

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
 * Shorten an address for labels: 0x1234…abcd.
 *
 * @param address - A hex address.
 * @returns The shortened form.
 */
export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}
