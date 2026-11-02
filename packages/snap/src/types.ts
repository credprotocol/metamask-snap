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

export type ExposureRisk =
  | 'sanctioned'
  | 'funded_by_sanctioned'
  | 'exposed'
  | 'none';

export type ExposureCounterparty = {
  address: string;
  entityName: string | null;
  /** `in`, `out` or `both`, relative to the screened address. */
  direction: string;
  lastSeen: string | null;
  /** Contact within the last 90 days. */
  recent: boolean;
};

export type ExposureFunding = {
  address: string;
  sanctioned: boolean;
  entityName: string | null;
};

/**
 * `/sanctions/exposure/{address}`: the direct screening plus one hop out,
 * the address that first funded the wallet and every counterparty it has
 * transacted with, screened against the same lists.
 */
export type ExposureResult = {
  address: string;
  sanctioned: boolean;
  matches: SanctionsMatch[];
  risk: ExposureRisk;
  /** `complete`, `partial` or `unavailable` (history could not be read). */
  coverage: string;
  fundingSource: ExposureFunding | null;
  counterpartiesChecked: number;
  sanctionedCounterparties: ExposureCounterparty[];
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
  /** Wallets only: contracts get the direct screen alone. */
  exposure?: ExposureResult | undefined;
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
