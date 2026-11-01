import { getSignInMessage, verifySignature } from './api';
import { utf8ToHex } from './hex';
import { getState, updateState, writeState } from './state';
import type { Auth } from './types';

/** Treat a token as expired a minute early so an in-flight call never 401s. */
const EXPIRY_MARGIN_MS = 60_000;

/**
 * The best credentials available for `address` without prompting: a pasted
 * API key wins (it is unlimited), otherwise an unexpired snap token for that
 * address, otherwise nothing.
 *
 * @param address - The connected account.
 * @returns Credentials, or null when the user has to sign in first.
 */
export async function getAuth(address: string): Promise<Auth | null> {
  const state = await getState();
  if (state.apiKey) {
    return { kind: 'apiKey', key: state.apiKey };
  }
  const session = state.sessions[address.toLowerCase()];
  if (session && session.expiry - EXPIRY_MARGIN_MS > Date.now()) {
    return {
      kind: 'snap',
      token: session.token,
      address: address.toLowerCase(),
    };
  }
  return null;
}

export type SignInError = 'rejected' | 'unavailable';

/**
 * Wallet sign-in: fetch the challenge, have MetaMask `personal_sign` it with
 * the user's account (a MetaMask prompt), exchange it for a snap-scoped
 * token and remember it.
 *
 * @param address - The account to sign in as.
 * @returns The new credentials, or why it failed.
 */
export async function signIn(
  address: string,
): Promise<{ ok: true; auth: Auth } | { ok: false; reason: SignInError }> {
  const challenge = await getSignInMessage(address);
  if (!challenge.ok) {
    return { ok: false, reason: 'unavailable' };
  }

  let signature: string;
  try {
    signature = (await ethereum.request({
      method: 'personal_sign',
      params: [utf8ToHex(challenge.data), address],
    })) as string;
  } catch {
    return { ok: false, reason: 'rejected' };
  }

  const verified = await verifySignature(address, challenge.data, signature);
  if (!verified.ok) {
    return { ok: false, reason: 'unavailable' };
  }

  const expiry = Date.parse(verified.data.expiry);
  const state = await getState();
  await updateState({
    sessions: {
      ...state.sessions,
      [address.toLowerCase()]: {
        token: verified.data.token,
        expiry: Number.isNaN(expiry) ? Date.now() + 23 * 3_600_000 : expiry,
      },
    },
  });

  return {
    ok: true,
    auth: {
      kind: 'snap',
      token: verified.data.token,
      address: address.toLowerCase(),
    },
  };
}

/**
 * Remember (or forget, with an empty string) a console API key.
 *
 * @param key - The key, or '' to clear it.
 */
export async function setApiKey(key: string): Promise<void> {
  const trimmed = key.trim();
  const state = await getState();
  const next = { ...state };
  if (trimmed) {
    next.apiKey = trimmed;
  } else {
    delete next.apiKey;
  }
  await writeState(next);
}

/**
 * The account MetaMask has exposed to the Snap, if any, without prompting.
 *
 * @returns The first permitted account, or null.
 */
export async function getConnectedAccount(): Promise<string | null> {
  try {
    const accounts = (await ethereum.request({
      method: 'eth_accounts',
    })) as string[] | null;
    return accounts?.[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * Ask MetaMask for account access (shows the account picker once).
 *
 * @returns The chosen account, or null when the user declined.
 */
export async function requestAccount(): Promise<string | null> {
  try {
    const accounts = (await ethereum.request({
      method: 'eth_requestAccounts',
    })) as string[] | null;
    return accounts?.[0] ?? null;
  } catch {
    return null;
  }
}
