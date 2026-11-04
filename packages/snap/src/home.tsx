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
  getSnapAuth,
  requestAccount,
  setApiKey,
  signIn,
} from './auth';
import type { FileView } from './file';
import {
  FILE_URL,
  inquiryPurpose,
  loadFile,
  loadMoreInquiries,
  shortDate,
} from './file';
import { rangeLabel, scoreSummary } from './format';
import { getState, updateState } from './state';
import type { HomeSnapshot, SnapState } from './types';

/** Re-use the last home-page payload for this long before refetching. */
const SNAPSHOT_TTL_MS = 5 * 60 * 1000;

type Notice = {
  severity: 'info' | 'warning' | 'danger' | 'success';
  text: string;
};

export type HomeView = {
  address: string | null;
  signedIn: boolean;
  /** Holds a wallet token (not just an API key): the file can be read. */
  walletSignedIn: boolean;
  hasApiKey: boolean;
  snapshot?: HomeSnapshot | undefined;
  notice?: Notice | undefined;
  /** Key factors and inquiries; absent until loaded. */
  file?: FileView | undefined;
};

/** The file lives here (memory), not in `snap_manageState`. */
type HomeContext = { address: string | null; file?: FileView };

/**
 * The interface context for `address`, with the file when there is one.
 *
 * @param address - The connected account, or null.
 * @param file - The loaded file, if any.
 * @returns JSON-safe context.
 */
function homeContext(
  address: string | null,
  file: FileView | undefined,
): HomeContext {
  return file ? { address, file } : { address };
}

/**
 * Build the view model for `address` from stored state only (no network).
 *
 * @param address - The connected account, or null.
 * @param state - The Snap's state.
 * @param notice - An optional one-off message.
 * @param file - The loaded file (interface context), if any.
 * @returns The view.
 */
async function buildView(
  address: string | null,
  state: SnapState,
  notice?: Notice,
  file?: FileView,
): Promise<HomeView> {
  const auth = address ? await getAuth(address) : null;
  const walletAuth = address ? await getSnapAuth(address) : null;
  const snapshot =
    address && state.home?.address === address.toLowerCase()
      ? state.home
      : undefined;
  return {
    address,
    signedIn: auth !== null,
    walletSignedIn: walletAuth !== null,
    hasApiKey: Boolean(state.apiKey),
    snapshot,
    notice,
    file: walletAuth ? file : undefined,
  };
}

/**
 * "Main reasons your score is not higher": the ranked key factors from your
 * file, only when there are some.
 *
 * @param file - The loaded file, if any.
 * @returns JSX, or null.
 */
export function renderKeyFactors(file: FileView | undefined) {
  if (!file || file.keyFactors.length === 0) {
    return null;
  }
  return (
    <Section>
      <Heading size="sm">Main reasons your score is not higher</Heading>
      {file.keyFactors.map((factor) => (
        <Box>
          <Text fontWeight="medium">{factor.label}</Text>
          {factor.description ? (
            <Text size="sm" color="muted">
              {factor.description}
            </Text>
          ) : null}
        </Box>
      ))}
    </Section>
  );
}

/**
 * "Who looked you up": the inquiry count and the loaded inquiries, a sign-in
 * prompt when only an API key is held (the file needs a wallet token), and
 * the link to the full file.
 *
 * @param view - What to show.
 * @returns JSX, or null when no account is connected or nobody is signed in.
 */
export function renderInquiries(view: HomeView) {
  if (!view.address || !view.signedIn) {
    // Signed out entirely: the main "Sign in with this wallet" covers it.
    return null;
  }
  const link = (
    <Text size="sm">
      <Link href={FILE_URL}>See your full file or dispute a record</Link>
    </Text>
  );

  if (!view.walletSignedIn) {
    return (
      <Section>
        <Heading size="sm">Who looked you up</Heading>
        <Text size="sm" color="muted">
          Your API key cannot open your own file. Sign in with this wallet to
          see who has received your score.
        </Text>
        <Button name="file-sign-in">Sign in with this wallet</Button>
        {link}
      </Section>
    );
  }

  const { file } = view;
  let body;
  if (!file) {
    body = <Text color="muted">Loading…</Text>;
  } else if (file.inquiries === null) {
    body =
      file.error === 'needs_sign_in' ? (
        <Box>
          <Text color="muted">Your session expired. Sign in again.</Text>
          <Button name="file-sign-in">Sign in with this wallet</Button>
        </Box>
      ) : (
        <Text color="muted">Unavailable right now. Try again later.</Text>
      );
  } else {
    const { inquiries } = file;
    body = (
      <Box>
        <Text>
          {file.count === 0
            ? `Nobody in the last ${file.months} months`
            : `${file.count} in the last ${file.months} months`}
        </Text>
        {inquiries.map((inquiry) => (
          <Row label={shortDate(inquiry.requestedAt)}>
            <Value
              value={inquiry.requesterLabel}
              extra={inquiryPurpose(inquiry)}
            />
          </Row>
        ))}
        {file.error ? (
          <Text size="sm" color="error">
            Could not load more. Try again later.
          </Text>
        ) : null}
        {file.nextBefore ? (
          <Button name="inquiries-more">Show more</Button>
        ) : null}
      </Box>
    );
  }

  return (
    <Section>
      <Heading size="sm">Who looked you up</Heading>
      {body}
      {link}
    </Section>
  );
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
      {renderKeyFactors(view.file)}

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
      {renderInquiries(view)}

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
 * @param file - The loaded file to keep showing, if any.
 */
async function show(
  id: string,
  address: string | null,
  notice?: Notice,
  file?: FileView,
) {
  const view = await buildView(address, await getState(), notice, file);
  await snap.request({
    method: 'snap_updateInterface',
    params: {
      id,
      ui: renderHome(view),
      context: homeContext(address, view.file),
    },
  });
}

/**
 * Read the file for `address` when a wallet token is held. Never throws.
 *
 * @param address - The connected account.
 * @returns The file, or undefined without a wallet token.
 */
async function fetchFile(address: string): Promise<FileView | undefined> {
  const auth = await getSnapAuth(address);
  return auth ? loadFile(auth) : undefined;
}

export const onHomePage: OnHomePageHandler = async () => {
  const address = await getConnectedAccount();
  const state = await getState();
  const view = await buildView(address, state);

  const id = await snap.request({
    method: 'snap_createInterface',
    params: {
      ui: renderHome(view),
      context: homeContext(address, undefined),
    },
  });

  // The file (key factors, inquiries) is fetched on every open and kept in
  // memory only. It loads alongside the snapshot but never holds it up.
  const filePromise =
    address && view.walletSignedIn ? fetchFile(address) : undefined;

  // Freshen a stale snapshot in the background of the first paint.
  const stale =
    address &&
    view.signedIn &&
    (!view.snapshot || Date.now() - view.snapshot.fetchedAt > SNAPSHOT_TTL_MS);
  let notice: Notice | undefined;
  if (stale) {
    notice = await refreshSnapshot(address);
    await show(id, address, notice);
  }
  if (filePromise) {
    await show(id, address, notice, await filePromise);
  }

  return { id };
};

export const onUserInput: OnUserInputHandler = async ({
  id,
  event,
  context,
}) => {
  const current = (context as HomeContext | null)?.address ?? null;
  const file = (context as HomeContext | null)?.file;

  if (
    event.type === UserInputEventType.FormSubmitEvent &&
    event.name === 'api-key'
  ) {
    const key = typeof event.value.key === 'string' ? event.value.key : '';
    await setApiKey(key);
    const notice: Notice = key
      ? { severity: 'success', text: 'API key saved.' }
      : { severity: 'info', text: 'No key entered.' };
    await show(id, current, notice, file);
    if (current && key) {
      await show(id, current, await refreshSnapshot(current), file);
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
    if (address) {
      const next = await fetchFile(address);
      if (next) {
        await show(id, address, undefined, next);
      }
    }
  } else if (
    (event.name === 'sign-in' || event.name === 'file-sign-in') &&
    current
  ) {
    const result = await signIn(current);
    if (result.ok) {
      const [notice, next] = await Promise.all([
        refreshSnapshot(current),
        fetchFile(current),
      ]);
      await show(id, current, notice, next);
    } else {
      await show(
        id,
        current,
        {
          severity: 'warning',
          text:
            result.reason === 'rejected'
              ? 'Signature declined.'
              : 'Could not sign in. Try again later.',
        },
        file,
      );
    }
  } else if (event.name === 'refresh' && current) {
    const [notice, next] = await Promise.all([
      refreshSnapshot(current),
      fetchFile(current),
    ]);
    await show(id, current, notice, next ?? file);
  } else if (event.name === 'inquiries-more' && current && file) {
    const auth = await getSnapAuth(current);
    const next = auth
      ? await loadMoreInquiries(file, auth)
      : { ...file, error: 'needs_sign_in' as const };
    await show(id, current, undefined, next);
  } else if (event.name === 'clear-key') {
    await setApiKey('');
    await show(
      id,
      current,
      { severity: 'info', text: 'API key removed.' },
      file,
    );
  }
};
