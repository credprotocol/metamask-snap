/**
 * Shapes of the Cred Protocol API responses the Snap consumes, plus the
 * Snap's own persisted state. Keep these narrow: every field the UI reads is
 * validated in `api.ts` before it is trusted.
 */

export type ScoreRange = 'excellent' | 'very_good' | 'good' | 'fair' | 'low';

export type ScoreFactor = {
  label: string;
  rating: ScoreRange | null;
  description: string;
};

export type ScoreResult = {
  address: string;
  score: number | null;
  range?: ScoreRange | undefined;
  decile?: number | undefined;
  modelVersion?: string | undefined;
  factors?: ScoreFactor[] | undefined;
};

export type SanctionsMatch = {
  source: string;
  entityName: string | null;
  programs: string | null;
};

export type SanctionsResult = {
  address: string;
  sanctioned: boolean;
  matches: SanctionsMatch[];
};

export type Allowance = {
  monthlyLimit: number;
  used: number;
  remaining: number;
  periodEnd: string;
};

/** How the Snap authenticates against the API. */
export type Auth =
  | { kind: 'apiKey'; key: string }
  | { kind: 'snap'; token: string; address: string };

export type Session = {
  token: string;
  /** Unix milliseconds. */
  expiry: number;
};

export type CachedInsight = {
  /** Unix milliseconds the lookup was made. */
  at: number;
  isContract: boolean;
  sanctions?: SanctionsResult | undefined;
  score?: ScoreResult | undefined;
};

export type HomeSnapshot = {
  address: string;
  /** Unix milliseconds. */
  fetchedAt: number;
  score?: ScoreResult | undefined;
  sanctions?: SanctionsResult | undefined;
  allowance?: Allowance | undefined;
};

export type SnapState = {
  /** A console API key pasted by the user; lifts the free allowance. */
  apiKey?: string | undefined;
  /** Snap-scoped wallet tokens, keyed by lowercase address. */
  sessions: Record<string, Session>;
  /** Transaction-insight lookups, keyed by lowercase address. */
  cache: Record<string, CachedInsight>;
  /** The last home-page payload, so reopening the page is instant. */
  home?: HomeSnapshot | undefined;
};
