import { describe, expect, it } from '@jest/globals';

import {
  exposureSummary,
  rangeLabel,
  sanctionsSummary,
  scoreSummary,
  shortAddress,
} from './format';
import { utf8ToHex, isAddress } from './hex';
import type { ExposureResult } from './types';

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

describe('exposureSummary', () => {
  const base: ExposureResult = {
    address: '0xab5801a7d398351b8be11c439e05c5b3259aec9b',
    sanctioned: false,
    matches: [],
    risk: 'none',
    coverage: 'complete',
    fundingSource: null,
    counterpartiesChecked: 10,
    sanctionedCounterparties: [],
  };

  it('names the sanctioned funder first', () => {
    expect(
      exposureSummary({
        ...base,
        risk: 'funded_by_sanctioned',
        fundingSource: {
          address: '0x8589427373d6d84e98730d7795d8f6f8731fda16',
          sanctioned: true,
          entityName: 'TORNADO CASH',
        },
      }),
    ).toBe('Funded by TORNADO CASH');
  });

  it('lists up to two counterparties by name and dates the last contact', () => {
    expect(
      exposureSummary({
        ...base,
        risk: 'exposed',
        sanctionedCounterparties: [
          {
            address: '0x8589427373d6d84e98730d7795d8f6f8731fda16',
            entityName: 'TORNADO CASH',
            direction: 'out',
            lastSeen: '2026-06-01T18:40:12+00:00',
            recent: false,
          },
          {
            address: '0x098b716b8aaf21512996dc57eb0615e2383e2f96',
            entityName: null,
            direction: 'in',
            lastSeen: '2025-01-10T00:00:00+00:00',
            recent: false,
          },
        ],
      }),
    ).toBe('Dealt with TORNADO CASH and 0x098b…2f96, last Jun 2026');
  });

  it('counts when there are more than two', () => {
    const hit = {
      address: '0x8589427373d6d84e98730d7795d8f6f8731fda16',
      entityName: 'A',
      direction: 'in',
      lastSeen: null,
      recent: true,
    };
    expect(
      exposureSummary({
        ...base,
        risk: 'exposed',
        sanctionedCounterparties: [
          hit,
          { ...hit, entityName: 'B' },
          { ...hit, entityName: 'C' },
        ],
      }),
    ).toBe('Dealt with 3 sanctioned addresses');
  });

  it('says so when nothing was found, qualified by coverage', () => {
    expect(exposureSummary(base)).toBe('None found');
    expect(exposureSummary({ ...base, coverage: 'partial' })).toBe(
      'None found in recent history',
    );
    expect(exposureSummary({ ...base, coverage: 'unavailable' })).toBe(
      'History unavailable right now',
    );
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
