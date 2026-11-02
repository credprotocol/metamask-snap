import type {
  OnHomePageHandler,
  OnUserInputHandler,
} from '@metamask/snaps-sdk';
import { UserInputEventType } from '@metamask/snaps-sdk';
import {
  Address,
  Banner,
  Box,
  Button,
  Divider,
  Field,
  Form,
  Heading,
  Input,
  Link,
  Row,
  Section,
  Text,
  Value,
} from '@metamask/snaps-sdk/jsx';

import { getAllowance, getScore, screenAddress } from './api';
import {
  getAuth,
  getConnectedAccount,
  requestAccount,
  setApiKey,
  signIn,
} from './auth';
import { rangeLabel, scoreSummary } from './format';
import { getState, updateState } from './state';
import type { HomeSnapshot, SnapState } from './types';

/** Re-use the last home-page payload for this long before refetching. */
const SNAPSHOT_TTL_MS = 5 * 60 * 1000;

type Notice = {
  severity: 'info' | 'warning' | 'danger' | 'success';
  text: string;
};

type HomeView = {
  address: string | null;
  signedIn: boolean;
  hasApiKey: boolean;
  snapshot?: HomeSnapshot | undefined;
  notice?: Notice | undefined;
};

type HomeContext = { address: string | null };

/**
 * Build the view model for `address` from stored state only (no network).
 *
 * @param address - The connected account, or null.
 * @param state - The Snap's state.
 * @param notice - An optional one-off message.
 * @returns The view.
 */
async function buildView(
  address: string | null,
  state: SnapState,
  notice?: Notice,
): Promise<HomeView> {
  const auth = address ? await getAuth(address) : null;
  const snapshot =
    address && state.home?.address === address.toLowerCase()
      ? state.home
      : undefined;
  return {
    address,
    signedIn: auth !== null,
    hasApiKey: Boolean(state.apiKey),
    snapshot,
    notice,
  };
}

/**
 * The home page UI.
 *
 * @param view - What to show.
 * @returns JSX.
 */
export function renderHome(view: HomeView) {
  const { address, snapshot } = view;
  const score = snapshot?.score;
  const sanctions = snapshot?.sanctions;
  const allowance = snapshot?.allowance;

  return (
    <Box>
      <Heading>Cred Protocol</Heading>
      {view.notice ? (
        <Banner
          title={view.notice.severity === 'danger' ? 'Error' : 'Note'}
          severity={view.notice.severity}
        >
          <Text>{view.notice.text}</Text>
        </Banner>
      ) : null}

      {address ? (
        <Section>
          <Row label="Account">
            <Address address={address as `0x${string}`} />
          </Row>
          <Row label="Cred score">
            {score ? (
              <Value
                value={scoreSummary(score)}
                extra={
                  typeof score.decile === 'number'
                    ? `top ${Math.max(1, 100 - score.decile * 10)}%`
                    : ''
                }
              />
            ) : (
              <Text color="muted">
                {view.signedIn ? 'Tap Refresh' : 'Sign in to load'}
              </Text>
            )}
          </Row>
          <Row
            label="OFAC sanctions"
            variant={sanctions?.sanctioned ? 'critical' : 'default'}
          >
            {sanctions ? (
              <Text color={sanctions.sanctioned ? 'error' : 'success'}>
                {sanctions.sanctioned ? 'Listed' : 'Not listed'}
              </Text>
            ) : (
              <Text color="muted">—</Text>
            )}
          </Row>
        </Section>
      ) : (
        <Text>
          Connect an account to see its Cred score and sanctions status.
        </Text>
      )}

      {score?.factors && score.factors.length > 0 ? (
        <Section>
          <Heading size="sm">Score factors</Heading>
          {score.factors.map((factor) => (
            <Row
              label={factor.label}
              tooltip={factor.description || undefined}
              variant={factor.rating === 'low' ? 'warning' : 'default'}
            >
              <Text>{rangeLabel(factor.rating) || 'Limited data'}</Text>
            </Row>
          ))}
        </Section>
      ) : null}

      {address ? (
        <Box direction="horizontal" alignment="space-between">
          {view.signedIn ? (
            <Button name="refresh">Refresh</Button>
          ) : (
            <Button name="sign-in" variant="primary">
              Sign in with this wallet
            </Button>
          )}
          <Button name="connect">Switch account</Button>
        </Box>
      ) : (
        <Button name="connect" variant="primary">
          Connect account
        </Button>
      )}

      {allowance ? (
        <Text size="sm" color="muted">
          {`${allowance.remaining} of ${allowance.monthlyLimit} free Cred Units left this month`}
        </Text>
      ) : null}
      {view.hasApiKey ? (
        <Text size="sm" color="muted">
          Using your API key: lookups are billed to your Cred Protocol account.
        </Text>
      ) : null}

      <Divider />
      <Heading size="sm">API key (optional)</Heading>
      <Text size="sm" color="muted">
        Transaction insights get 300 free Cred Units per month: a wallet costs 4
        (sanctions exposure 3, score 1), a contract 1. Paste a key from
        app.credprotocol.com for unlimited lookups.
      </Text>
      <Form name="api-key">
        <Field label="API key">
          <Input name="key" type="password" placeholder="Paste your API key" />
        </Field>
        <Button type="submit" name="save-key">
          Save key
        </Button>
      </Form>
      {view.hasApiKey ? (
        <Button name="clear-key" variant="destructive">
          Remove key
        </Button>
      ) : null}

      <Text size="sm">
        <Link href="https://score.credprotocol.com">
          Full report at score.credprotocol.com
        </Link>
      </Text>
    </Box>
  );
}

/**
 * Fetch the connected account's own score, sanctions status and allowance
 * and remember them. Own-wallet calls are free; the allowance call only
 * exists for snap tokens.
 *
 * @param address - The connected account.
 * @returns A notice when something went wrong.
 */
async function refreshSnapshot(address: string): Promise<Notice | undefined> {
  const auth = await getAuth(address);
  if (!auth) {
    return { severity: 'warning', text: 'Sign in first.' };
  }

  const [score, sanctions, allowance] = await Promise.all([
    getScore(address, auth, true),
    screenAddress(address, auth),
    auth.kind === 'snap' ? getAllowance(auth) : Promise.resolve(undefined),
  ]);

  const state = await getState();
  const previous =
    state.home?.address === address.toLowerCase() ? state.home : undefined;
  await updateState({
    home: {
      address: address.toLowerCase(),
      fetchedAt: Date.now(),
      score: score.ok ? score.data : previous?.score,
      sanctions: sanctions.ok ? sanctions.data : previous?.sanctions,
      allowance: allowance?.ok ? allowance.data : previous?.allowance,
    },
  });

  if (!score.ok && score.reason === 'needs_sign_in') {
    return {
      severity: 'warning',
      text: 'Your session expired. Sign in again.',
    };
  }
  if (!score.ok || !sanctions.ok) {
    return {
      severity: 'warning',
      text: 'Cred Protocol is unavailable right now. Try again later.',
    };
  }
  return undefined;
}

/**
 * Re-render the home page interface from stored state.
 *
 * @param id - The interface id from `snap_createInterface`.
 * @param address - The connected account, or null.
 * @param notice - An optional one-off message.
 */
async function show(id: string, address: string | null, notice?: Notice) {
  const view = await buildView(address, await getState(), notice);
  await snap.request({
    method: 'snap_updateInterface',
    params: {
      id,
      ui: renderHome(view),
      context: { address } satisfies HomeContext,
    },
  });
}

export const onHomePage: OnHomePageHandler = async () => {
  const address = await getConnectedAccount();
  const state = await getState();
  const view = await buildView(address, state);

  const id = await snap.request({
    method: 'snap_createInterface',
    params: {
      ui: renderHome(view),
      context: { address } satisfies HomeContext,
    },
  });

  // Freshen a stale snapshot in the background of the first paint.
  const stale =
    address &&
    view.signedIn &&
    (!view.snapshot || Date.now() - view.snapshot.fetchedAt > SNAPSHOT_TTL_MS);
  if (stale) {
    const notice = await refreshSnapshot(address);
    await show(id, address, notice);
  }

  return { id };
};

export const onUserInput: OnUserInputHandler = async ({
  id,
  event,
  context,
}) => {
  const current = (context as HomeContext | null)?.address ?? null;

  if (
    event.type === UserInputEventType.FormSubmitEvent &&
    event.name === 'api-key'
  ) {
    const key = typeof event.value.key === 'string' ? event.value.key : '';
    await setApiKey(key);
    const notice: Notice = key
      ? { severity: 'success', text: 'API key saved.' }
      : { severity: 'info', text: 'No key entered.' };
    await show(id, current, notice);
    if (current && key) {
      await show(id, current, await refreshSnapshot(current));
    }
    return;
  }

  if (event.type !== UserInputEventType.ButtonClickEvent) {
    return;
  }

  if (event.name === 'connect') {
    const address = await requestAccount();
    await show(
      id,
      address,
      address ? undefined : { severity: 'info', text: 'No account connected.' },
    );
  } else if (event.name === 'sign-in' && current) {
    const result = await signIn(current);
    if (result.ok) {
      await show(id, current, await refreshSnapshot(current));
    } else {
      await show(id, current, {
        severity: 'warning',
        text:
          result.reason === 'rejected'
            ? 'Signature declined.'
            : 'Could not sign in. Try again later.',
      });
    }
  } else if (event.name === 'refresh' && current) {
    await show(id, current, await refreshSnapshot(current));
  } else if (event.name === 'clear-key') {
    await setApiKey('');
    await show(id, current, { severity: 'info', text: 'API key removed.' });
  }
};
