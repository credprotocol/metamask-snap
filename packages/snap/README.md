# @cred-protocol/metamask-snap

The Cred Protocol Snap for MetaMask: OFAC sanctions screening and Cred credit
scores for the addresses you transact with, shown on the confirmation screen,
plus your own score on a home page.

Install from a dapp:

```js
await window.ethereum.request({
  method: 'wallet_requestSnaps',
  params: { 'npm:@cred-protocol/metamask-snap': {} },
});
```

See the [repository README](https://github.com/credprotocol/metamask-snap#readme)
for how it works, permissions, privacy and development.
