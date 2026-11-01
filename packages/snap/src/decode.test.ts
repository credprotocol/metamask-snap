import { describe, expect, it } from '@jest/globals';

import { resolveTarget } from './decode';

const TO = '0xdAC17F958D2ee523a2206206994597C13D831ec7'; // USDT
const RECIPIENT = '0x742d35cc6634c0532925a3b844bc454e4438f44e';
const OTHER = '0xd8da6bf26964af9d7eed9e03e53415d37aa96045';

const word = (address: string) => address.slice(2).padStart(64, '0');
const amount = 1n.toString(16).padStart(64, '0');

describe('resolveTarget', () => {
  it('uses `to` for a plain transfer', () => {
    expect(resolveTarget({ to: TO, data: '0x' })).toStrictEqual({
      address: TO.toLowerCase(),
      role: 'to',
    });
  });

  it('returns null for contract creation', () => {
    expect(resolveTarget({ to: '', data: '0x6080' })).toBeNull();
    expect(
      resolveTarget({ to: undefined as unknown as string, data: '0x' }),
    ).toBeNull();
  });

  it('decodes the recipient of an ERC-20 transfer', () => {
    const data = `0xa9059cbb${word(RECIPIENT)}${amount}`;
    expect(resolveTarget({ to: TO, data })).toStrictEqual({
      address: RECIPIENT,
      role: 'recipient',
    });
  });

  it('decodes the recipient (second argument) of transferFrom', () => {
    const data = `0x23b872dd${word(OTHER)}${word(RECIPIENT)}${amount}`;
    expect(resolveTarget({ to: TO, data })).toStrictEqual({
      address: RECIPIENT,
      role: 'recipient',
    });
  });

  it('decodes the spender of an approve', () => {
    const data = `0x095ea7b3${word(OTHER)}${amount}`;
    expect(resolveTarget({ to: TO, data })).toStrictEqual({
      address: OTHER,
      role: 'spender',
    });
  });

  it('is case-insensitive about the selector', () => {
    const data = `0xA9059CBB${word(RECIPIENT)}${amount}`;
    expect(resolveTarget({ to: TO, data })?.role).toBe('recipient');
  });

  it('falls back to `to` when the argument word is not a clean address', () => {
    const dirty = `0xa9059cbb${'ff'.repeat(12)}${RECIPIENT.slice(2)}${amount}`;
    expect(resolveTarget({ to: TO, data: dirty })).toStrictEqual({
      address: TO.toLowerCase(),
      role: 'to',
    });
  });

  it('falls back to `to` when calldata is truncated', () => {
    expect(resolveTarget({ to: TO, data: '0xa9059cbb00' })).toStrictEqual({
      address: TO.toLowerCase(),
      role: 'to',
    });
  });

  it('ignores unknown selectors', () => {
    const data = `0x12345678${word(RECIPIENT)}`;
    expect(resolveTarget({ to: TO, data })?.role).toBe('to');
  });
});
