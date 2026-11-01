import type { OnTransactionHandler } from '@metamask/snaps-sdk';
import {
  Address,
  Banner,
  Box,
  Link,
  Row,
  Section,
  Text,
  Value,
} from '@metamask/snaps-sdk/jsx';

import type { ApiFailure, ApiResult } from './api';
import { getScore, screenAddress } from './api';
import { getAuth } from './auth';
import type { Target } from './decode';
import { resolveTarget } from './decode';
import { sanctionsSummary, scoreSummary } from './format';
import { getState, updateState } from './state';
import type {
  Auth,
  CachedInsight,
  SanctionsResult,
  ScoreResult,
} from './types';

/** Matches the API's own score/report cache. */
const CACHE_TTL_MS = 5 * 60 * 1000;

export const HOME_PAGE_HINT = 'Open the Cred Protocol page from the Snaps menu';

type Insight = {
  isContract: boolean;
  sanctions: ApiResult<SanctionsResult>;
  /** Absent for contracts: a credit score only means something for a wallet. */
  score?: ApiResult<ScoreResult> | undefined;
};

/**
 * Whether code is deployed at `address` on the network MetaMask is currently
 * on — during a confirmation that is the transaction's chain. Unknown counts
 * as "not a contract" so a flaky RPC never hides a score.
 *
 * @param address - The address to probe.
 * @returns True when `eth_getCode` returns bytecode.
 */
async function isContract(address: string): Promise<boolean> {
  try {
    const code = (await ethereum.request({
      method: 'eth_getCode',
      params: [address, 'latest'],
    })) as string | null;
    return typeof code === 'string' && code !== '0x' && code !== '';
  } catch {
    return false;
  }
}

/**
 * Screen and score `address`, serving a recent answer from the Snap's own
 * cache so re-opening a confirmation does not spend the allowance twice.
 *
 * @param address - The target address (lowercase).
 * @param auth - Credentials to use.
 * @returns The insight.
 */
async function lookup(address: string, auth: Auth): Promise<Insight> {
  const state = await getState();
  const cached = state.cache[address];
  if (cached && Date.now() - cached.at < CACHE_TTL_MS && cached.sanctions) {
    return {
      isContract: cached.isContract,
      sanctions: { ok: true, data: cached.sanctions },
      score: cached.score ? { ok: true, data: cached.score } : undefined,
    };
  }

  const contract = await isContract(address);
  const [sanctions, score] = await Promise.all([
    screenAddress(address, auth),
    contract ? Promise.resolve(undefined) : getScore(address, auth),
  ]);

  if (sanctions.ok && (score === undefined || score.ok)) {
    const entry: CachedInsight = {
      at: Date.now(),
      isContract: contract,
      sanctions: sanctions.data,
      score: score?.ok ? score.data : undefined,
    };
    // Keep the cache small: the newest 50 addresses.
    const entries = Object.entries(state.cache)
      .filter(([, value]) => Date.now() - value.at < CACHE_TTL_MS)
      .slice(-49);
    await updateState({
      cache: Object.fromEntries([...entries, [address, entry]]),
    });
  }

  return { isContract: contract, sanctions, score };
}

const ROLE_LABELS: Record<Target['role'], string> = {
  to: 'Recipient',
  recipient: 'Token recipient',
  spender: 'Approved spender',
};

/**
 * One line explaining why a lookup produced no data.
 *
 * @param reason - Why the API call failed.
 * @returns Short user-facing text.
 */
function failureText(reason: ApiFailure): string {
  const texts = new Map<ApiFailure, string>([
    ['needs_sign_in', 'Sign in again on the Cred page'],
    ['allowance_exhausted', 'Free lookups used up this month'],
    ['forbidden', 'Not available for this address'],
    ['not_found', 'Address not found'],
    ['unavailable', 'Unavailable right now'],
  ]);
  return texts.get(reason) ?? 'Unavailable right now';
}

/**
 * The "Cred score" cell: a value, a reason it is missing, or a note that
 * contracts are not scored.
 *
 * @param insight - Lookup results.
 * @returns JSX for the row's value.
 */
function scoreCell(insight: Insight) {
  if (insight.isContract) {
    return <Text color="muted">Contract — not scored</Text>;
  }
  if (!insight.score) {
    return <Text color="muted">Unavailable</Text>;
  }
  if (!insight.score.ok) {
    return <Text color="muted">{failureText(insight.score.reason)}</Text>;
  }
  const { decile } = insight.score.data;
  return (
    <Value
      value={scoreSummary(insight.score.data)}
      extra={
        typeof decile === 'number'
          ? `top ${Math.max(1, 100 - decile * 10)}%`
          : ''
      }
    />
  );
}

/**
 * Whether a failed result was the monthly allowance running out.
 *
 * @param result - A lookup result, possibly absent.
 * @returns True on `allowance_exhausted`.
 */
function exhausted(result: ApiResult<unknown> | undefined): boolean {
  return Boolean(
    result && !result.ok && result.reason === 'allowance_exhausted',
  );
}

/**
 * The confirmation-screen UI for a resolved target.
 *
 * @param target - Which address the insight is about.
 * @param insight - Lookup results.
 * @returns The JSX to show.
 */
export function renderInsight(target: Target, insight: Insight) {
  const sanctioned = insight.sanctions.ok && insight.sanctions.data.sanctioned;
  const needsAttention =
    exhausted(insight.sanctions) || exhausted(insight.score);

  return (
    <Box>
      {sanctioned && insight.sanctions.ok ? (
        <Banner title="Sanctioned address" severity="danger">
          <Text>
            This address is on an OFAC sanctions list:{' '}
            {sanctionsSummary(insight.sanctions.data)}. Interacting with it may
            be illegal in your jurisdiction.
          </Text>
        </Banner>
      ) : null}
      <Section>
        <Row label={ROLE_LABELS[target.role]}>
          <Address address={target.address} />
        </Row>
        <Row
          label="OFAC sanctions"
          variant={sanctioned ? 'critical' : 'default'}
        >
          {insight.sanctions.ok ? (
            <Text color={sanctioned ? 'error' : 'success'}>
              {sanctioned ? 'Listed' : 'Not listed'}
            </Text>
          ) : (
            <Text color="muted">{failureText(insight.sanctions.reason)}</Text>
          )}
        </Row>
        <Row
          label="Cred score"
          variant={
            insight.score?.ok && insight.score.data.range === 'low'
              ? 'warning'
              : 'default'
          }
        >
          {scoreCell(insight)}
        </Row>
      </Section>
      {needsAttention ? (
        <Text size="sm" color="warning">
          {HOME_PAGE_HINT} to add an API key for unlimited lookups.
        </Text>
      ) : null}
      <Text size="sm" color="muted">
        Data by <Link href="https://credprotocol.com">Cred Protocol</Link>.
        Scores are 300–1000; insights are informational.
      </Text>
    </Box>
  );
}

/**
 * Shown when the Snap has no credentials for the sending account.
 *
 * @returns The JSX to show.
 */
export function renderSignInHint() {
  return (
    <Box>
      <Text>
        Sign in once to see the recipient's OFAC sanctions status and Cred score
        here.
      </Text>
      <Text size="sm" color="muted">
        {HOME_PAGE_HINT} and choose "Sign in with this wallet".
      </Text>
    </Box>
  );
}

export const onTransaction: OnTransactionHandler = async ({ transaction }) => {
  const target = resolveTarget(transaction);
  if (!target) {
    return {
      content: (
        <Box>
          <Text>Nothing to check: this transaction has no recipient.</Text>
        </Box>
      ),
    };
  }

  const auth = await getAuth(transaction.from);
  if (!auth) {
    return { content: renderSignInHint() };
  }

  const insight = await lookup(target.address, auth);
  return { content: renderInsight(target, insight) };
};
