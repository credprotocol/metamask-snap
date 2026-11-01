import { describe, expect, it } from '@jest/globals';

import {
  rangeLabel,
  sanctionsSummary,
  scoreSummary,
  shortAddress,
} from './format';
import { utf8ToHex, isAddress } from './hex';

describe('rangeLabel', () => {
  it('maps the API ranges to labels', () => {
    expect(rangeLabel('excellent')).toBe('Excellent');
    expect(rangeLabel('very_good')).toBe('Very good');
    expect(rangeLabel('low')).toBe('Low');
  });

  it('is lenient about unknown values', () => {
    expect(rangeLabel('super_duper')).toBe('super duper');
    expect(rangeLabel(null)).toBe('');
    expect(rangeLabel(undefined)).toBe('');
  });
});

describe('scoreSummary', () => {
  it('formats score and range', () => {
    expect(scoreSummary({ address: '0x', score: 742.4, range: 'good' })).toBe(
      '742 · Good',
    );
  });

  it('handles a missing range and a missing score', () => {
    expect(scoreSummary({ address: '0x', score: 650 })).toBe('650');
    expect(scoreSummary({ address: '0x', score: null })).toBe('No score');
  });
});

describe('sanctionsSummary', () => {
  it('names the matched entities once each', () => {
    expect(
      sanctionsSummary({
        address: '0x',
        sanctioned: true,
        matches: [
          {
            source: 'ofac_sdn',
            entityName: 'TORNADO CASH',
            programs: 'CYBER2',
          },
          {
            source: 'ofac_consolidated',
            entityName: 'TORNADO CASH',
            programs: 'CYBER2',
          },
          { source: 'ofac_sdn', entityName: null, programs: null },
        ],
      }),
    ).toBe('TORNADO CASH (CYBER2), ofac_sdn');
  });
});

describe('hex helpers', () => {
  it('encodes UTF-8 text for personal_sign', () => {
    expect(utf8ToHex('hi')).toBe('0x6869');
    expect(utf8ToHex('é')).toBe('0xc3a9');
  });

  it('recognises addresses', () => {
    expect(isAddress('0x742d35Cc6634C0532925a3b844Bc454e4438f44e')).toBe(true);
    expect(isAddress('0x742d')).toBe(false);
    expect(isAddress(42)).toBe(false);
  });

  it('shortens addresses', () => {
    expect(shortAddress('0x742d35Cc6634C0532925a3b844Bc454e4438f44e')).toBe(
      '0x742d…f44e',
    );
  });
});
