/* eslint-disable @typescript-eslint/naming-convention -- raw API bodies are snake_case */
import { describe, expect, it } from '@jest/globals';

import { parseExposure } from './api';

const WALLET = '0xab5801a7d398351b8be11c439e05c5b3259aec9b';
const TORNADO = '0x8589427373d6d84e98730d7795d8f6f8731fda16';

const match = {
  source: 'ofac_sdn',
  entity_name: 'TORNADO CASH',
  entity_type: 'Entity',
  programs: 'CYBER2',
};

describe('parseExposure', () => {
  it('maps a full exposure body', () => {
    const result = parseExposure({
      address: WALLET,
      sanctioned: false,
      matches: [],
      risk: 'funded_by_sanctioned',
      coverage: 'complete',
      funding_source: {
        address: TORNADO,
        chain_id: 1,
        sanctioned: true,
        matches: [match],
      },
      exposure: {
        counterparties_checked: 412,
        sanctioned_counterparties: [
          {
            address: TORNADO,
            direction: 'both',
            last_seen: '2026-06-01T18:40:12+00:00',
            recent: false,
            matches: [match],
          },
          { address: 42 }, // malformed: dropped
        ],
        recent: false,
      },
    });

    expect(result).toStrictEqual({
      address: WALLET,
      sanctioned: false,
      matches: [],
      risk: 'funded_by_sanctioned',
      coverage: 'complete',
      fundingSource: {
        address: TORNADO,
        sanctioned: true,
        entityName: 'TORNADO CASH',
      },
      counterpartiesChecked: 412,
      sanctionedCounterparties: [
        {
          address: TORNADO,
          entityName: 'TORNADO CASH',
          direction: 'both',
          lastSeen: '2026-06-01T18:40:12+00:00',
          recent: false,
        },
      ],
    });
  });

  it('accepts a clean body with no funding source', () => {
    const result = parseExposure({
      address: WALLET,
      sanctioned: false,
      matches: [],
      risk: 'none',
      coverage: 'partial',
      funding_source: null,
      exposure: { counterparties_checked: 3, sanctioned_counterparties: [] },
    });
    expect(result?.risk).toBe('none');
    expect(result?.fundingSource).toBeNull();
    expect(result?.coverage).toBe('partial');
  });

  it('rejects bodies that are not exposure results', () => {
    expect(parseExposure(null)).toBeNull();
    expect(parseExposure({ sanctioned: true })).toBeNull();
    expect(
      parseExposure({ sanctioned: true, risk: 'maybe', exposure: {} }),
    ).toBeNull();
    expect(parseExposure({ sanctioned: true, risk: 'none' })).toBeNull();
  });
});
