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
import { getExposure, getScore, screenAddress } from './api';
import { getAuth } from './auth';
import type { Target } from './decode';
import { resolveTarget } from './decode';
import { exposureSummary, sanctionsSummary, scoreSummary } from './format';
import { getState, updateState } from './state';
import type {
  Auth,
  CachedInsight,
  ExposureResult,
  SanctionsResult,
  ScoreResult,
} from './types';

/** Matches the API's own score/report cache. */
const CACHE_TTL_MS = 5 * 60 * 1000;

export const HOME_PAGE_HINT = 'Open the Cred Protocol page from the Snaps menu';

type Insight = {
  isContract: boolean;
  sanctions: ApiResult<SanctionsResult>;
  /**
   * Wallets only: who funded the address and whom it has dealt with. A
   * contract's counterparties are its users, which says nothing about it.
   */
  exposure?: ApiResult<ExposureResult> | undefined;
  /** Absent for contracts: a credit score only means something for a wallet. */
  score?: ApiResult<ScoreResult> | undefined;
};

/**
 * A contract gets the direct screen only (1 CU): its counterparties are its
 * users, which says nothing about the contract.
 *
 * @param address - The contract address (lowercase).
 * @param auth - Credentials to use.
 * @returns The direct screen, with no exposure.
 */
async function screenContract(
  address: string,
  auth: Auth,
): Promise<Pick<Insight, 'sanctions' | 'exposure'>> {
  return { sanctions: await screenAddress(address, auth), exposure: undefined };
}

/**
 * Screen a wallet one hop out (3 CU). The exposure answer carries the direct
 * screen too, so it replaces the 1 CU screen call; if it fails outright the
 * direct screen is fetched instead, so a listed address is never missed
 * because the history feeds were slow.
 *
 * @param address - The wallet address (lowercase).
 * @param auth - Credentials to use.
 * @returns The direct screen and, when it answered, the exposure.
 */
async function screenWallet(
  address: string,
  auth: Auth,
): Promise<Pick<Insight, 'sanctions' | 'exposure'>> {
  const exposure = await getExposure(address, auth);
  if (exposure.ok) {
    const { data } = exposure;
    return {
      sanctions: {
        ok: true,
        data: {
          address: data.address,
          sanctioned: data.sanctioned,
          matches: data.matches,
        },
      },
      exposure,
    };
  }
  if (exposure.reason === 'unavailable' || exposure.reason === 'not_found') {
    return { sanctions: await screenAddress(address, auth), exposure };
  }
  // Sign-in, allowance and scope failures apply to the screen call too.
  return { sanctions: exposure, exposure };
}

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
      exposure: cached.exposure
        ? { ok: true, data: cached.exposure }
        : undefined,
      score: cached.score ? { ok: true, data: cached.score } : undefined,
    };
  }

  const contract = await isContract(address);
  const [{ sanctions, exposure }, score] = await Promise.all([
    contract ? screenContract(address, auth) : screenWallet(address, auth),
    contract ? Promise.resolve(undefined) : getScore(address, auth),
  ]);

  if (sanctions.ok && (score === undefined || score.ok)) {
    const entry: CachedInsight = {
      at: Date.now(),
      isContract: contract,
      sanctions: sanctions.data,
      exposure: exposure?.ok ? exposure.data : undefined,
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

  return { isContract: contract, sanctions, exposure, score };
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
 * The "Sanctions exposure" cell for a wallet: a verdict on its funding and
 * counterparties, or why there is none.
 *
 * @param insight - Lookup results.
 * @returns JSX for the row's value.
 */
function exposureCell(insight: Insight) {
  if (!insight.exposure) {
    return <Text color="muted">Unavailable</Text>;
  }
  if (!insight.exposure.ok) {
    return <Text color="muted">{failureText(insight.exposure.reason)}</Text>;
  }
  const { data } = insight.exposure;
  return <Text color={exposureColor(data)}>{exposureSummary(data)}</Text>;
}

/**
 * Text colour for an exposure verdict.
 *
 * @param data - An exposure result.
 * @returns A Text colour.
 */
function exposureColor(
  data: ExposureResult,
): 'error' | 'warning' | 'muted' | 'success' {
  if (data.risk === 'funded_by_sanctioned') {
    return 'error';
  }
  if (data.risk === 'exposed') {
    return 'warning';
  }
  return data.coverage === 'unavailable' ? 'muted' : 'success';
}

/**
 * Row variant for an exposure verdict.
 *
 * @param exposure - The exposure lookup result, possibly absent.
 * @returns A Row variant.
 */
function exposureVariant(
  exposure: ApiResult<ExposureResult> | undefined,
): 'critical' | 'warning' | 'default' {
  if (!exposure?.ok) {
    return 'default';
  }
  if (exposure.data.risk === 'funded_by_sanctioned') {
    return 'critical';
  }
  return exposure.data.risk === 'exposed' ? 'warning' : 'default';
}

/**
 * The banner a wallet's exposure deserves, if any: red when its first funds
 * came from a sanctioned address, yellow when it has dealt with one.
 *
 * @param insight - Lookup results.
 * @returns A Banner, or null.
 */
function exposureBanner(insight: Insight) {
  if (!insight.exposure?.ok || !insight.sanctions.ok) {
    return null;
  }
  const { data } = insight.exposure;
  if (data.risk === 'funded_by_sanctioned') {
    return (
      <Banner title="Funded by a sanctioned address" severity="danger">
        <Text>
          This address first received funds from{' '}
          {data.fundingSource?.entityName ??
            'an address on an OFAC sanctions list'}
          . Funds that passed through a sanctioned service may be tainted.
        </Text>
      </Banner>
    );
  }
  if (data.risk === 'exposed') {
    return (
      <Banner title="Sanctions exposure" severity="warning">
        <Text>
          {exposureSummary(data)}. It is not listed itself, but it has
          transacted with an address that is.
        </Text>
      </Banner>
    );
  }
  return null;
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
    exhausted(insight.sanctions) ||
    exhausted(insight.exposure) ||
    exhausted(insight.score);

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
      {sanctioned ? null : exposureBanner(insight)}
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
        {insight.isContract ? null : (
          <Row
            label="Sanctions exposure"
            variant={exposureVariant(insight.exposure)}
          >
            {exposureCell(insight)}
          </Row>
        )}
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
