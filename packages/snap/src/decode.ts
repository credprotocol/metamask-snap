import type { Transaction } from '@metamask/snaps-sdk';

import { isAddress } from './hex';

/** The address a transaction is really about, and why. */
export type Target = {
  address: `0x${string}`;
  /**
   * `to`: the transaction's own recipient; `recipient`: the ERC-20 transfer
   * recipient decoded from calldata; `spender`: the ERC-20 approval spender.
   */
  role: 'to' | 'recipient' | 'spender';
};

// 4-byte selectors of the ERC-20 calls whose first argument (or second, for
// transferFrom) names the party that matters more than the token contract.
const SELECTORS: Record<string, { role: Target['role']; argIndex: number }> = {
  '0xa9059cbb': { role: 'recipient', argIndex: 0 }, // transfer(address,uint256)
  '0x23b872dd': { role: 'recipient', argIndex: 1 }, // transferFrom(address,address,uint256)
  '0x095ea7b3': { role: 'spender', argIndex: 0 }, // approve(address,uint256)
};

/**
 * Read an ABI-encoded address argument out of calldata.
 *
 * @param data - The full 0x-prefixed calldata.
 * @param argIndex - Zero-based position of the argument.
 * @returns The address, or null when the word is not a clean address.
 */
function readAddressArg(data: string, argIndex: number): `0x${string}` | null {
  const start = 10 + argIndex * 64; // "0x" + 8-char selector, then 32-byte words
  const word = data.slice(start, start + 64);
  if (word.length !== 64 || !/^0{24}[0-9a-fA-F]{40}$/u.test(word)) {
    return null;
  }
  return `0x${word.slice(24)}`;
}

/**
 * Decide which address the insight should be about.
 *
 * @param transaction - The transaction MetaMask is asking about.
 * @returns The target, or null for contract creation / unparseable input.
 */
export function resolveTarget(
  transaction: Pick<Transaction, 'to' | 'data'>,
): Target | null {
  const to = transaction.to?.toLowerCase();
  if (!isAddress(to)) {
    return null;
  }

  const data = typeof transaction.data === 'string' ? transaction.data : '';
  const selector = data.slice(0, 10).toLowerCase();
  const decoder = SELECTORS[selector];
  if (decoder) {
    const decoded = readAddressArg(data, decoder.argIndex);
    if (decoded) {
      return { address: decoded, role: decoder.role };
    }
  }

  return { address: to, role: 'to' };
}
