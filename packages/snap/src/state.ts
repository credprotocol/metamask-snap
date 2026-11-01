import type { Json } from '@metamask/snaps-sdk';

import type { SnapState } from './types';

const EMPTY_STATE: SnapState = { sessions: {}, cache: {} };

/**
 * Read the Snap's encrypted state, filling in defaults for a fresh install.
 * Encrypted state is only readable while MetaMask is unlocked, which is always
 * the case on the confirmation screen and the home page.
 *
 * @returns The current state.
 */
export async function getState(): Promise<SnapState> {
  const stored = (await snap.request({
    method: 'snap_manageState',
    params: { operation: 'get' },
  })) as Partial<SnapState> | null;

  return {
    ...EMPTY_STATE,
    ...(stored ?? {}),
    sessions: stored?.sessions ?? {},
    cache: stored?.cache ?? {},
  };
}

/**
 * Persist a whole state object. `undefined` fields are dropped on the way
 * (they are not JSON, which is all `snap_manageState` accepts).
 *
 * @param next - The state to store.
 */
export async function writeState(next: SnapState): Promise<void> {
  const json = JSON.parse(JSON.stringify(next)) as Record<string, Json>;
  await snap.request({
    method: 'snap_manageState',
    params: { operation: 'update', newState: json },
  });
}

/**
 * Merge a partial update into the stored state.
 *
 * @param update - Fields to overwrite.
 * @returns The state after the update.
 */
export async function updateState(
  update: Partial<SnapState>,
): Promise<SnapState> {
  const next = { ...(await getState()), ...update };
  await writeState(next);
  return next;
}
