/**
 * Cred Protocol MetaMask Snap.
 *
 * `onTransaction` shows the OFAC sanctions status and Cred score of the
 * address a transaction is really about, on the confirmation screen.
 * `onHomePage` and `onUserInput` drive the home page: the connected
 * account's own score, wallet sign-in, and an optional API key.
 *
 * The Snap talks to https://api.credprotocol.com only.
 */

export { onHomePage, onUserInput } from './home';
export { onTransaction } from './insights';
