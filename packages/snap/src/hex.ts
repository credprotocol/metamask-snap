/**
 * Encode a UTF-8 string as a 0x-prefixed hex string, the form
 * `personal_sign` expects for its message parameter.
 *
 * @param text - The text to encode.
 * @returns The hex-encoded bytes.
 */
export function utf8ToHex(text: string): `0x${string}` {
  const bytes = new TextEncoder().encode(text);
  let encoded = '';
  for (const byte of bytes) {
    encoded += byte.toString(16).padStart(2, '0');
  }
  return `0x${encoded}`;
}

/**
 * Whether a value looks like a 20-byte EVM address.
 *
 * @param value - The value to test.
 * @returns True for `0x` followed by 40 hex characters.
 */
export function isAddress(value: unknown): value is `0x${string}` {
  return typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/u.test(value);
}
