/* eslint-disable @typescript-eslint/naming-convention -- raw API bodies are snake_case */
import { afterEach, describe, expect, it } from '@jest/globals';
import { UserInputEventType } from '@metamask/snaps-sdk';

import { parseConsumerFile, parseInquiryPage } from './api';
import type { FileView } from './file';
import { inquiryPurpose, loadFile, loadMoreInquiries, shortDate } from './file';
import type { HomeView } from './home';
import { onUserInput, renderInquiries, renderKeyFactors } from './home';
import { at, fakeFetch, fakeSnap } from './test-utils';
import type { InquiryPage, SnapAuth } from './types';

const WALLET = '0x742d35cc6634c0532925a3b844bc454e4438f44e';
const AUTH: SnapAuth = { kind: 'snap', token: 'snap-token', address: WALLET };

const KEY_FACTORS = [
  {
    code: 'thin_history',
    label: 'Short credit history',
    description: 'Your wallet has borrowed for less than a year.',
  },
  {
    code: 'liquidations',
    label: 'Recent liquidation',
    description: 'A loan was liquidated in the last 12 months.',
  },
];

const FILE_BODY = {
  address: WALLET,
  generated_at: '2026-11-03T10:00:00Z',
  partial: false,
  score: { score: 712, decile: 7, range: 'good', key_factors: KEY_FACTORS },
  score_history: [],
  credit_events: null,
  inquiries: { address: WALLET, months: 24, count: 0, inquiries: [] },
  rights: {},
};

/**
 * A raw inquiry as `/wallet/inquiries` returns it.
 *
 * @param day - Day of October 2026.
 * @param label - Requester label.
 * @param extra - Field overrides.
 * @returns The raw item.
 */
function rawInquiry(day: number, label: string, extra = {}) {
  return {
    requested_at: `2026-10-${String(day).padStart(2, '0')}T12:00:00Z`,
    endpoint: '/score/address/{address}',
    requester: { kind: 'customer', label },
    purpose: null,
    delivery_mode: 'commercial',
    request_purpose: null,
    end_user: null,
    ...extra,
  };
}

const PAGE_ONE = {
  address: WALLET,
  months: 24,
  count: 7,
  inquiries: [
    rawInquiry(30, 'acme.com', { purpose: 'Underwriting' }),
    rawInquiry(29, 'You', { requester: { kind: 'self', label: 'You' } }),
    rawInquiry(28, 'lender.xyz', {
      delivery_mode: 'consumer_report',
      request_purpose: 'credit_transaction',
      end_user: 'Acme Lending LLC',
    }),
    rawInquiry(27, 'MPP payment (tempo)'),
    rawInquiry(26, 'beta.io'),
  ],
  next_before: '2026-10-26T12:00:00Z',
};

const PAGE_TWO = {
  address: WALLET,
  months: 24,
  count: 7,
  inquiries: [rawInquiry(20, 'gamma.org'), rawInquiry(10, 'delta.net')],
  next_before: null,
};

const ok = (body: unknown) => () => ({ body });
const fail = (status: number) => () => ({ status, body: { detail: 'no' } });

let network: ReturnType<typeof fakeFetch> | undefined;

/**
 * Route `fetch` for one test (restored after each test).
 *
 * @param routes - See `fakeFetch`.
 * @returns The recorded calls.
 */
function route(routes: Parameters<typeof fakeFetch>[0]) {
  network?.restore();
  network = fakeFetch(routes);
  return network.calls;
}

/** The first page as `loadFile` would hold it, built without the network. */
const FIRST_VIEW: FileView = {
  keyFactors: KEY_FACTORS,
  inquiries: (parseInquiryPage(PAGE_ONE) as InquiryPage).inquiries,
  count: 7,
  months: 24,
  nextBefore: PAGE_ONE.next_before,
};

/**
 * A signed-in home view with the given file.
 *
 * @param file - The file, if loaded.
 * @returns The view.
 */
function signedInView(file?: FileView): HomeView {
  return {
    address: WALLET,
    signedIn: true,
    walletSignedIn: true,
    hasApiKey: false,
    file,
  };
}

/** Undo `route` (registered with `afterEach` in each describe that uses it). */
function restoreNetwork() {
  network?.restore();
  network = undefined;
}

describe('parsing', () => {
  it('reads key factors from the file and drops malformed ones', () => {
    expect(
      parseConsumerFile({
        ...FILE_BODY,
        score: { key_factors: [...KEY_FACTORS, { code: 'x' }, 42] },
      }),
    ).toStrictEqual({
      address: WALLET,
      partial: false,
      keyFactors: KEY_FACTORS,
    });
  });

  it('treats a partial file without a score as having no key factors', () => {
    expect(
      parseConsumerFile({ ...FILE_BODY, partial: true, score: null }),
    ).toStrictEqual({ address: WALLET, partial: true, keyFactors: [] });
  });

  it('rejects a body that is not an inquiry page', () => {
    expect(parseInquiryPage({ detail: 'nope' })).toBeNull();
    expect(FIRST_VIEW.inquiries).toHaveLength(5);
  });

  it('labels purposes and dates', () => {
    const { inquiries } = FIRST_VIEW;
    expect(inquiryPurpose(at(inquiries, 0))).toBe('Underwriting');
    expect(inquiryPurpose(at(inquiries, 2))).toBe(
      'Credit transaction for Acme Lending LLC',
    );
    expect(inquiryPurpose(at(inquiries, 3))).toBe('');
    expect(shortDate('2026-10-30T12:00:00Z')).toBe('30 Oct 2026');
    expect(shortDate('garbage')).toBe('garbage');
  });
});

describe('loadFile', () => {
  afterEach(restoreNetwork);

  it('reads key factors and the first five inquiries with the wallet token', async () => {
    const calls = route({
      '/wallet/file': ok(FILE_BODY),
      '/wallet/inquiries': ok(PAGE_ONE),
    });

    const view = await loadFile(AUTH);

    expect(view).toStrictEqual(FIRST_VIEW);
    expect(at(view.inquiries, 4).requesterLabel).toBe('beta.io');
    expect(calls.map((call) => call.url).sort()).toStrictEqual([
      'https://api.credprotocol.com/api/v2/wallet/file',
      'https://api.credprotocol.com/api/v2/wallet/inquiries?limit=5',
    ]);
    expect(calls.map((call) => call.headers.Authorization)).toStrictEqual([
      'Bearer snap-token',
      'Bearer snap-token',
    ]);
  });

  it('keeps the inquiries when the file call fails', async () => {
    route({
      '/wallet/file': fail(503),
      '/wallet/inquiries': ok(PAGE_ONE),
    });

    const view = await loadFile(AUTH);

    expect(view).toStrictEqual({ ...FIRST_VIEW, keyFactors: [] });
  });

  it('reports an expired token when both calls are refused', async () => {
    route({ '/wallet/file': fail(401), '/wallet/inquiries': fail(401) });

    const view = await loadFile(AUTH);

    expect(view.inquiries).toBeNull();
    expect(view.error).toBe('needs_sign_in');
  });

  it('survives the network being down', async () => {
    route('offline');

    const view = await loadFile(AUTH);

    expect(view).toStrictEqual({
      keyFactors: [],
      inquiries: null,
      count: 0,
      months: 24,
      nextBefore: null,
      error: 'unavailable',
    });
  });
});

describe('loadMoreInquiries', () => {
  afterEach(restoreNetwork);

  it('appends the next page using next_before as the cursor', async () => {
    const calls = route({ '/wallet/inquiries': ok(PAGE_TWO) });

    const next = await loadMoreInquiries(FIRST_VIEW, AUTH);

    expect(calls).toHaveLength(1);
    const url = new URL(at(calls, 0).url);
    expect(url.pathname).toBe('/api/v2/wallet/inquiries');
    expect(url.searchParams.get('before')).toBe('2026-10-26T12:00:00Z');
    expect(url.searchParams.get('limit')).toBe('5');
    expect(next.inquiries).toHaveLength(7);
    expect(at(next.inquiries, -1).requesterLabel).toBe('delta.net');
    expect(next.nextBefore).toBeNull();
  });

  it('keeps what was loaded when the next page fails', async () => {
    route('offline');

    const next = await loadMoreInquiries(FIRST_VIEW, AUTH);

    expect(next).toStrictEqual({ ...FIRST_VIEW, error: 'unavailable' });
  });

  it('does nothing on the last page', async () => {
    const calls = route('offline');
    const last = { ...FIRST_VIEW, nextBefore: null };

    expect(await loadMoreInquiries(last, AUTH)).toBe(last);
    expect(calls).toHaveLength(0);
  });
});

describe('rendering', () => {
  it('renders key factors with their descriptions, only when present', () => {
    const content = JSON.stringify(renderKeyFactors(FIRST_VIEW));
    expect(content).toContain('Main reasons your score is not higher');
    expect(content).toContain('Short credit history');
    expect(content).toContain('A loan was liquidated in the last 12 months.');

    expect(renderKeyFactors({ ...FIRST_VIEW, keyFactors: [] })).toBeNull();
    expect(renderKeyFactors(undefined)).toBeNull();
  });

  it('renders the count, labels, purposes, Show more and the file link', () => {
    const content = JSON.stringify(renderInquiries(signedInView(FIRST_VIEW)));
    expect(content).toContain('Who looked you up');
    expect(content).toContain('7 in the last 24 months');
    expect(content).toContain('acme.com');
    expect(content).toContain('Underwriting');
    expect(content).toContain('30 Oct 2026');
    expect(content).toContain('Credit transaction for Acme Lending LLC');
    expect(content).toContain('"name":"inquiries-more"');
    expect(content).toContain('https://score.credprotocol.com/file');
  });

  it('hides Show more on the last page', () => {
    const content = JSON.stringify(
      renderInquiries(
        signedInView({
          keyFactors: [],
          inquiries: [],
          count: 0,
          months: 24,
          nextBefore: null,
        }),
      ),
    );
    expect(content).toContain('Nobody in the last 24 months');
    expect(content).not.toContain('inquiries-more');
  });

  it('shows a short note, not an error page, when the file is unavailable', () => {
    const content = JSON.stringify(
      renderInquiries(
        signedInView({
          keyFactors: [],
          inquiries: null,
          count: 0,
          months: 24,
          nextBefore: null,
          error: 'unavailable',
        }),
      ),
    );
    expect(content).toContain('Unavailable right now');
    expect(content).toContain('https://score.credprotocol.com/file');
  });

  it('offers to sign in again when the token was refused', () => {
    const content = JSON.stringify(
      renderInquiries(
        signedInView({
          keyFactors: [],
          inquiries: null,
          count: 0,
          months: 24,
          nextBefore: null,
          error: 'needs_sign_in',
        }),
      ),
    );
    expect(content).toContain('Your session expired');
    expect(content).toContain('"name":"file-sign-in"');
  });

  it('keeps the loaded inquiries and says so when Show more failed', () => {
    const content = JSON.stringify(
      renderInquiries(signedInView({ ...FIRST_VIEW, error: 'unavailable' })),
    );
    expect(content).toContain('acme.com');
    expect(content).toContain('Could not load more');
    expect(content).toContain('"name":"inquiries-more"');
  });

  it('asks for a wallet sign-in when only an API key is held', () => {
    const content = JSON.stringify(
      renderInquiries({
        ...signedInView(),
        walletSignedIn: false,
        hasApiKey: true,
      }),
    );
    expect(content).toContain('"name":"file-sign-in"');
    expect(content).not.toContain('inquiries-more');
  });

  it('renders nothing when signed out (the main sign-in button covers it)', () => {
    expect(
      renderInquiries({
        ...signedInView(),
        signedIn: false,
        walletSignedIn: false,
      }),
    ).toBeNull();
  });
});

describe('onUserInput "Show more"', () => {
  let snapFake: ReturnType<typeof fakeSnap> | undefined;

  afterEach(() => {
    restoreNetwork();
    snapFake?.restore();
    snapFake = undefined;
  });

  it('fetches the next page and re-renders the interface with it', async () => {
    const calls = route({ '/wallet/inquiries': ok(PAGE_TWO) });
    snapFake = fakeSnap({
      sessions: {
        [WALLET]: { token: 'snap-token', expiry: Date.now() + 3_600_000 },
      },
      cache: {},
    });

    await onUserInput({
      id: 'home',
      event: {
        type: UserInputEventType.ButtonClickEvent,
        name: 'inquiries-more',
      },
      context: { address: WALLET, file: FIRST_VIEW },
    });

    expect(calls).toHaveLength(1);
    expect(at(calls, 0).url).toContain('before=2026-10-26T12%3A00%3A00Z');
    expect(snapFake.updates).toHaveLength(1);
    const update = at(snapFake.updates, 0);
    const content = JSON.stringify(update.ui);
    expect(content).toContain('gamma.org');
    expect(content).toContain('delta.net');
    expect(content).toContain('acme.com');
    expect(content).not.toContain('inquiries-more');
    expect((update.context as { file: FileView }).file.inquiries).toHaveLength(
      7,
    );
  });

  it('asks to sign in again, keeping the list, when the token has expired', async () => {
    const calls = route('offline');
    snapFake = fakeSnap({ sessions: {}, cache: {} });

    await onUserInput({
      id: 'home',
      event: {
        type: UserInputEventType.ButtonClickEvent,
        name: 'inquiries-more',
      },
      context: { address: WALLET, file: FIRST_VIEW },
    });

    expect(calls).toHaveLength(0);
    // No wallet token any more: the section falls back to signed-out.
    expect(snapFake.updates).toHaveLength(1);
    expect(JSON.stringify(at(snapFake.updates, 0).ui)).toContain(
      '"name":"sign-in"',
    );
  });
});
