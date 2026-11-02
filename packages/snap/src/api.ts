import type {
  Allowance,
  Auth,
  ExposureCounterparty,
  ExposureResult,
  ExposureRisk,
  SanctionsMatch,
  SanctionsResult,
  ScoreFactor,
  ScoreRange,
  ScoreResult,
} from './types';

/** Only ever `https:` — the Snap contacts no other host. */
export const API_BASE = 'https://api.credprotocol.com/api/v2';

/** Per-call budget; insights have a hard 15 s limit in the manifest. */
const TIMEOUT_MS = 8_000;

export type ApiFailure =
  | 'needs_sign_in' // 401: no usable token
  | 'forbidden' // 403: the token may not see this address
  | 'allowance_exhausted' // 429 snap_allowance_exceeded
  | 'not_found' // 404: unresolvable address / ENS
  | 'unavailable'; // network, timeout, 5xx, malformed body

export type ApiResult<Data> =
  | { ok: true; data: Data }
  | { ok: false; reason: ApiFailure; status?: number };

type RequestOptions = {
  auth?: Auth;
  method?: 'GET' | 'POST';
  body?: unknown;
};

/**
 * Perform one API call and classify the outcome. Never throws.
 *
 * @param path - Path under `API_BASE`, starting with `/`.
 * @param options - Auth, method and body.
 * @returns The parsed JSON body, or a failure reason.
 */
async function request(
  path: string,
  options: RequestOptions = {},
): Promise<ApiResult<unknown>> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.auth?.kind === 'apiKey') {
    headers.Authorization = `Bearer ${options.auth.key}`;
  } else if (options.auth?.kind === 'snap') {
    headers.Authorization = `Bearer ${options.auth.token}`;
  }
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const init: RequestInit = {
      method: options.method ?? 'GET',
      headers,
      signal: controller.signal,
    };
    if (options.body !== undefined) {
      init.body = JSON.stringify(options.body);
    }
    const response = await fetch(`${API_BASE}${path}`, init);

    if (response.ok) {
      return { ok: true, data: await response.json() };
    }

    const { status } = response;
    if (status === 401) {
      return { ok: false, reason: 'needs_sign_in', status };
    }
    if (status === 403) {
      return { ok: false, reason: 'forbidden', status };
    }
    if (status === 404) {
      return { ok: false, reason: 'not_found', status };
    }
    if (status === 429) {
      const body = (await response.json().catch(() => null)) as {
        detail?: { error?: string };
      } | null;
      if (body?.detail?.error === 'snap_allowance_exceeded') {
        return { ok: false, reason: 'allowance_exhausted', status };
      }
    }
    return { ok: false, reason: 'unavailable', status };
  } catch {
    return { ok: false, reason: 'unavailable' };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Narrow to a plain object.
 *
 * @param value - Anything.
 * @returns True for non-null, non-array objects.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * A string field, or a fallback when it is missing or not a string.
 *
 * @param value - The raw field.
 * @param fallback - Returned for non-strings.
 * @returns The string.
 */
function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

const RANGES = new Set<string>([
  'excellent',
  'very_good',
  'good',
  'fair',
  'low',
]);

/**
 * Narrow a raw `range` / `rating` field to a known score range.
 *
 * @param value - The raw field.
 * @returns The range, or undefined for anything unexpected.
 */
function asRange(value: unknown): ScoreRange | undefined {
  return typeof value === 'string' && RANGES.has(value)
    ? (value as ScoreRange)
    : undefined;
}

/**
 * Validate a `/score/address/{address}` body.
 *
 * @param body - Parsed JSON.
 * @returns The score, or null when the body is not a score.
 */
function parseScore(body: unknown): ScoreResult | null {
  if (!isRecord(body) || typeof body.address !== 'string') {
    return null;
  }
  const factors = Array.isArray(body.factors)
    ? body.factors
        .filter(isRecord)
        .map(
          (factor): ScoreFactor => ({
            label: asString(factor.label),
            rating: asRange(factor.rating) ?? null,
            description: asString(factor.description),
          }),
        )
        .filter((factor) => factor.label)
    : undefined;

  return {
    address: body.address,
    score: typeof body.score === 'number' ? body.score : null,
    range: asRange(body.range),
    decile: typeof body.decile === 'number' ? body.decile : undefined,
    modelVersion:
      typeof body.model_version === 'string' ? body.model_version : undefined,
    factors,
  };
}

/**
 * Validate a list of sanctions-list matches.
 *
 * @param value - The raw `matches` field.
 * @returns The matches; an empty list for anything that is not a list.
 */
function parseMatches(value: unknown): SanctionsMatch[] {
  return Array.isArray(value)
    ? value.filter(isRecord).map((match) => ({
        source: asString(match.source, 'unknown'),
        entityName:
          typeof match.entity_name === 'string' ? match.entity_name : null,
        programs: typeof match.programs === 'string' ? match.programs : null,
      }))
    : [];
}

/**
 * Validate a `/sanctions/screen/{address}` body.
 *
 * @param body - Parsed JSON.
 * @returns The screening result, or null when the body is not one.
 */
function parseSanctions(body: unknown): SanctionsResult | null {
  if (!isRecord(body) || typeof body.sanctioned !== 'boolean') {
    return null;
  }
  return {
    address: asString(body.address),
    sanctioned: body.sanctioned,
    matches: parseMatches(body.matches),
  };
}

const RISKS = new Set<string>([
  'sanctioned',
  'funded_by_sanctioned',
  'exposed',
  'none',
]);

/**
 * The name of the first sanctions-list match, for labelling a counterparty.
 *
 * @param matches - Parsed matches.
 * @returns The entity name, or null.
 */
function firstEntityName(matches: SanctionsMatch[]): string | null {
  return matches.find((match) => match.entityName)?.entityName ?? null;
}

/**
 * Validate a `/sanctions/exposure/{address}` body.
 *
 * @param body - Parsed JSON.
 * @returns The exposure result, or null when the body is not one.
 */
export function parseExposure(body: unknown): ExposureResult | null {
  if (
    !isRecord(body) ||
    typeof body.sanctioned !== 'boolean' ||
    typeof body.risk !== 'string' ||
    !RISKS.has(body.risk) ||
    !isRecord(body.exposure)
  ) {
    return null;
  }
  const funding = isRecord(body.funding_source) ? body.funding_source : null;
  const raw = Array.isArray(body.exposure.sanctioned_counterparties)
    ? body.exposure.sanctioned_counterparties.filter(isRecord)
    : [];
  const sanctionedCounterparties = raw
    .map(
      (entry): ExposureCounterparty => ({
        address: asString(entry.address),
        entityName: firstEntityName(parseMatches(entry.matches)),
        direction: asString(entry.direction, 'both'),
        lastSeen: typeof entry.last_seen === 'string' ? entry.last_seen : null,
        recent: entry.recent === true,
      }),
    )
    .filter((entry) => entry.address);

  return {
    address: asString(body.address),
    sanctioned: body.sanctioned,
    matches: parseMatches(body.matches),
    risk: body.risk as ExposureRisk,
    coverage: asString(body.coverage, 'unavailable'),
    fundingSource:
      funding && typeof funding.address === 'string'
        ? {
            address: funding.address,
            sanctioned: funding.sanctioned === true,
            entityName: firstEntityName(parseMatches(funding.matches)),
          }
        : null,
    counterpartiesChecked:
      typeof body.exposure.counterparties_checked === 'number'
        ? body.exposure.counterparties_checked
        : 0,
    sanctionedCounterparties,
  };
}

/**
 * Validate a `/wallet/allowance` body.
 *
 * @param body - Parsed JSON.
 * @returns The allowance, or null when the body is not one.
 */
function parseAllowance(body: unknown): Allowance | null {
  if (
    !isRecord(body) ||
    typeof body.monthly_limit !== 'number' ||
    typeof body.used !== 'number' ||
    typeof body.remaining !== 'number'
  ) {
    return null;
  }
  return {
    monthlyLimit: body.monthly_limit,
    used: body.used,
    remaining: body.remaining,
    periodEnd: asString(body.period_end),
  };
}

/**
 * Apply a validator to a successful result; a body that fails validation is
 * reported as `unavailable`, never trusted.
 *
 * @param result - The raw result.
 * @param parse - Validator returning null on a bad body.
 * @returns The typed result.
 */
function parsed<Data>(
  result: ApiResult<unknown>,
  parse: (body: unknown) => Data | null,
): ApiResult<Data> {
  if (!result.ok) {
    return result;
  }
  const data = parse(result.data);
  return data ? { ok: true, data } : { ok: false, reason: 'unavailable' };
}

/**
 * Step 1 of wallet sign-in: the challenge to sign.
 *
 * @param address - The wallet address.
 * @returns The message text.
 */
export async function getSignInMessage(
  address: string,
): Promise<ApiResult<string>> {
  return parsed(await request(`/wallet/message/${address}`), (body) =>
    isRecord(body) && typeof body.message === 'string' ? body.message : null,
  );
}

/**
 * Step 3 of wallet sign-in: exchange the signature for a snap-scoped token.
 *
 * @param address - The wallet address.
 * @param message - The exact challenge text.
 * @param signature - The `personal_sign` result.
 * @returns Token and expiry (ISO string).
 */
export async function verifySignature(
  address: string,
  message: string,
  signature: string,
): Promise<ApiResult<{ token: string; expiry: string }>> {
  return parsed(
    await request('/wallet/verify', {
      method: 'POST',
      body: { address, message, signature, scope: 'snap' },
    }),
    (body) =>
      isRecord(body) &&
      typeof body.token === 'string' &&
      typeof body.expiry === 'string'
        ? { token: body.token, expiry: body.expiry }
        : null,
  );
}

/**
 * OFAC screening (1 Cred Unit for addresses other than the token's own).
 *
 * @param address - Any EVM address.
 * @param auth - API key or snap token.
 * @returns The screening result.
 */
export async function screenAddress(
  address: string,
  auth: Auth,
): Promise<ApiResult<SanctionsResult>> {
  return parsed(
    await request(`/sanctions/screen/${address}`, { auth }),
    parseSanctions,
  );
}

/**
 * OFAC screening of an address, the address that first funded it and
 * every counterparty of its transfers (3 Cred Units for addresses other
 * than the token's own). Ethereum mainnet history.
 *
 * @param address - An EVM wallet address.
 * @param auth - API key or snap token.
 * @returns The exposure result.
 */
export async function getExposure(
  address: string,
  auth: Auth,
): Promise<ApiResult<ExposureResult>> {
  return parsed(
    await request(`/sanctions/exposure/${address}`, { auth }),
    parseExposure,
  );
}

/**
 * Credit score (1 Cred Unit for addresses other than the token's own).
 *
 * @param address - An EVM address.
 * @param auth - API key or snap token.
 * @param includeFactors - Also return the factor breakdown (home page).
 * @returns The score.
 */
export async function getScore(
  address: string,
  auth: Auth,
  includeFactors = false,
): Promise<ApiResult<ScoreResult>> {
  const query = includeFactors ? '?include_factors=true' : '';
  return parsed(
    await request(`/score/address/${address}${query}`, { auth }),
    parseScore,
  );
}

/**
 * The free monthly allowance left on a snap token. Not available to API keys.
 *
 * @param auth - A snap token.
 * @returns The allowance.
 */
export async function getAllowance(auth: Auth): Promise<ApiResult<Allowance>> {
  return parsed(await request('/wallet/allowance', { auth }), parseAllowance);
}
