# Cred Protocol MetaMask Snap

A [MetaMask Snap](https://metamask.io/snaps/) that puts Cred Protocol's
on-chain credit data where it matters:

- **Transaction insights.** Before you confirm a transaction, the Snap shows
  whether the recipient is on an OFAC sanctions list, whether it was funded
  by or has transacted with a sanctioned address, and what its Cred credit
  score is. For ERC-20 `transfer`, `transferFrom` and `approve` calls it looks
  at the real recipient or spender, not the token contract. A listed or
  sanctioned-funded recipient shows as a red banner, a recipient that has
  dealt with a sanctioned address as a yellow one.
- **Home page.** Your own Cred score (300–1000), score factors and sanctions
  status, under the Snaps menu.

Package: `@cred-protocol/metamask-snap`. Snap ID: `npm:@cred-protocol/metamask-snap`.

## How it works

The Snap talks to one host only, `https://api.credprotocol.com`.

1. **Sign in** (home page → "Sign in with this wallet"): the Snap fetches a
   challenge from `/api/v2/wallet/message/{address}`, asks MetaMask to
   `personal_sign` it, and exchanges the signature at `/api/v2/wallet/verify`
   with `scope: "snap"` for a 24-hour wallet token. Reading your own wallet's
   data is free and unlimited.
2. **Transaction insights** look up _other_ addresses: for a wallet,
   `/api/v2/sanctions/exposure/{address}` (3 CU: the direct OFAC screen plus
   the address that first funded it and every counterparty it has transacted
   with on Ethereum) and `/api/v2/score/address/{address}` (1 CU); for a
   contract, `/api/v2/sanctions/screen/{address}` (1 CU) only. Each wallet
   token gets **300 free Cred Units per calendar month** for that, so about
   75 wallet transactions. `GET /api/v2/wallet/allowance` shows the balance.
3. **Optional API key.** Paste a key from
   [app.credprotocol.com](https://app.credprotocol.com) on the home page for
   unlimited lookups billed to your Cred Protocol account.

Tokens, the API key and a five-minute lookup cache live in the Snap's
encrypted state (`snap_manageState`). Nothing else is stored.

### Permissions

| Permission                      | Why                                                                                                               |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `endowment:transaction-insight` | Show insights on the confirmation screen (with the dapp origin)                                                   |
| `endowment:page-home`           | The home page                                                                                                     |
| `endowment:ethereum-provider`   | `eth_accounts` / `eth_requestAccounts`, `personal_sign` for sign-in, `eth_getCode` to tell contracts from wallets |
| `endowment:network-access`      | `fetch` to `api.credprotocol.com`                                                                                 |
| `snap_manageState`              | Remember the wallet token, API key and lookup cache                                                               |

`endowment:network-access` is a protected permission, so the Snap must be
allowlisted by MetaMask before it can be installed in the stable extension.
Until then it runs in [MetaMask Flask](https://metamask.io/flask/).

### Privacy

To show an insight the Snap sends the recipient address (and, when signed in,
your own address via the token) to Cred Protocol. See the
[privacy policy](https://credprotocol.com/privacy).

## Development

Requirements: Node 20.11+, Yarn (the repo pins `yarn@3.2.1`), MetaMask Flask.

```shell
yarn install
yarn start        # snap on :8080, companion site on :8000
yarn build        # mm-snap build (also recomputes the manifest shasum)
yarn test         # jest: pure unit tests + @metamask/snaps-jest end-to-end
yarn lint
```

Layout (`packages/snap/src`):

| File                                          | Role                                                                                                      |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `api.ts`                                      | Fetch client with an 8 s timeout; classifies 401/403/404/429 into typed failures; validates every payload |
| `auth.ts`                                     | API key vs. wallet token selection, the `personal_sign` sign-in, account access                           |
| `decode.ts`                                   | Picks the address a transaction is about (ERC-20 selector decoding)                                       |
| `insights.tsx`                                | `onTransaction`                                                                                           |
| `home.tsx`                                    | `onHomePage` + `onUserInput` (interactive home page)                                                      |
| `state.ts`, `types.ts`, `format.ts`, `hex.ts` | Persistence, response shapes, labels, hex helpers                                                         |

The end-to-end tests use `@metamask/snaps-jest`, which runs the bundle in a
simulated MetaMask. They cover the paths that need no network (no
credentials, contract creation, the signed-out home page); the decoding and
formatting logic is unit-tested directly.

Note: the repo must live at a path without spaces — `@metamask/snaps-utils`
URL-encodes the path when evaluating the bundle and then cannot find its
worker.

## Releasing

1. Bump `version` in `packages/snap/package.json` **and**
   `packages/snap/snap.manifest.json` (they must match), run `yarn build` so
   the manifest `shasum` is updated, commit.
2. `yarn workspace @cred-protocol/metamask-snap npm publish --access public`.
3. Scan with [Snapper](https://github.com/sayfer-io/Snapper) and fix every
   finding.
4. Submit the version through the MetaMask Snaps Directory form. Allowlisting
   is per version: users cannot install a new version until it is approved.

## Roadmap

- `severity: "critical"` on sanctions hits once stable MetaMask supports it
  (Flask-only today).
- Signature insights: screen the spender in Permit / Permit2 signatures.
- Daily score-change notifications.
- A `cred_getScore` JSON-RPC method so dapps can ask for a consented score.

## License

MIT © Cred Protocol. Scaffolded from MetaMask's template-snap-monorepo (MIT-0).
