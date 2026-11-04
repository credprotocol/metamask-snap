/**
 * Fakes for unit tests that drive the API client or the home page handlers
 * outside the snaps-jest simulator (which has no network mocking). Not
 * imported by the Snap, so never bundled.
 */

type Route = (url: URL) => { status?: number; body: unknown };

export type FetchCall = { url: string; headers: Record<string, string> };

/**
 * Replace `globalThis.fetch` with a router over `routes`, keyed by the path
 * after `/api/v2` (prefix match). Unrouted paths answer 500; `'offline'`
 * makes every call reject.
 *
 * @param routes - Path prefix to response, or `'offline'`.
 * @returns The recorded calls and a restore function.
 */
export function fakeFetch(routes: Record<string, Route> | 'offline') {
  const original = globalThis.fetch;
  const calls: FetchCall[] = [];

  globalThis.fetch = (async (input: string, init?: RequestInit) => {
    calls.push({
      url: input,
      headers: (init?.headers ?? {}) as Record<string, string>,
    });
    if (routes === 'offline') {
      throw new Error('offline');
    }
    const url = new URL(input);
    const path = url.pathname.replace('/api/v2', '');
    const route = Object.entries(routes).find(([prefix]) =>
      path.startsWith(prefix),
    )?.[1];
    const { status = 200, body } = route
      ? route(url)
      : { status: 500, body: { detail: 'not mocked' } };
    // Just the surface `request()` in api.ts reads.
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => JSON.parse(JSON.stringify(body)),
    };
  }) as unknown as typeof fetch;

  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

export type InterfaceUpdate = { id: string; ui: unknown; context: unknown };

/**
 * Install a minimal `snap` global: `snap_manageState` serves `state`,
 * `snap_updateInterface` is recorded, everything else returns null.
 *
 * @param state - The Snap state to serve.
 * @returns The recorded updates and a restore function.
 */
export function fakeSnap(state: Record<string, unknown>) {
  const holder = globalThis as { snap?: unknown };
  const original = holder.snap;
  const updates: InterfaceUpdate[] = [];

  holder.snap = {
    request: async ({
      method,
      params,
    }: {
      method: string;
      params: InterfaceUpdate;
    }) => {
      if (method === 'snap_manageState') {
        return state;
      }
      if (method === 'snap_updateInterface') {
        updates.push(params);
      }
      return null;
    },
  };

  return {
    updates,
    restore: () => {
      holder.snap = original;
    },
  };
}

/**
 * The element at `index`, or a thrown error that fails the test.
 *
 * @param list - A list that may be missing.
 * @param index - The index; negative counts from the end.
 * @returns The element.
 */
export function at<Item>(
  list: readonly Item[] | null | undefined,
  index: number,
): Item {
  const item = list?.at(index);
  if (item === undefined) {
    throw new Error(`no element at ${index}`);
  }
  return item;
}
