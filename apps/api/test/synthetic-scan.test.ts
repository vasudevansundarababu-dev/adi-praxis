import { KYC_EXAMPLE_TASK, syntheticGenerator } from '@praxis/shared';
import { describe, expect, it } from 'vitest';
import { scanForRealData } from '../src/tasks/synthetic-scan';

const kinds = (text: string) => scanForRealData({ text }).map((f) => f.kind);

describe('synthetic-data scan (TASK-KYC section 2)', () => {
  it('passes the worked example and everything the synthetic generator produces', () => {
    expect(scanForRealData(KYC_EXAMPLE_TASK)).toEqual([]);
    const g = syntheticGenerator('scan');
    const name = g.personName();
    expect(kinds([name, g.address(), g.passportNumber(), g.companyNumber(), g.nationalId(), g.email(name), g.phone(), `passport number ${g.passportNumber()}`, `company number ${g.companyNumber()}`].join('\n'))).toEqual([]);
  });

  it('flags identifiers that pass real checksums or national formats', () => {
    expect(kinds('IBAN GB82 WEST 1234 5698 7654 32')).toEqual(['IBAN']);
    expect(kinds('card 4111 1111 1111 1111')).toEqual(['CARD_NUMBER']);
    expect(kinds('NI number AB 12 34 56 C')).toEqual(['UK_NI_NUMBER']);
    expect(kinds('SSN 123-45-6789')).toEqual(['US_SSN']);
    expect(kinds('passport no. 533380006')).toEqual(['PASSPORT_NUMBER']);
    expect(kinds('company number 01234567')).toEqual(['COMPANY_NUMBER']);
  });

  it('allows reserved and fictitious ranges, and ordinary words after a label', () => {
    expect(kinds('NI QQ 12 34 56 C; SSN 987-65-4321; card 4111 1111 1111 1112')).toEqual([]);
    expect(kinds('Passport expired at onboarding; the registration number was missing')).toEqual([]);
    expect(kinds('mail analyst@example.com or case@bank.test; call 07700 900123 or 020 7946 0123 or (555) 555-0199')).toEqual([]);
  });

  it('flags real-looking contact details', () => {
    expect(kinds('Email compliance.officer@hsbc.co.uk')).toEqual(['EMAIL']);
    expect(kinds('Call 07911 123456')).toEqual(['PHONE']);
    // Indian mobile formats (testers are in India).
    for (const n of ['+91 98765 43210', '+91-9876543210', '0091 9876543210', '98765 43210', '9876543210']) expect(kinds(`Call ${n}`)).toEqual(['PHONE']);
  });

  it('does not mistake hex ids for phone numbers', () => {
    expect(kinds('ref 8f14e45f-0842-6265-9468-2c1d5b7a9e10')).toEqual([]);
  });

  it('reports the JSON path of each flag', () => {
    expect(scanForRealData({ parties: [{ contact: 'x@realbank.com' }] })).toEqual([expect.objectContaining({ kind: 'EMAIL', path: 'parties[0].contact' })]);
  });

  it('ignores UUIDs whose digits pass the card checksum, but still flags a real card next to one', () => {
    expect(kinds('templateId 18494366-7685-4028-9c1e-2b3f4a5d6e7f')).toEqual([]);
    expect(kinds('id 18494366-7685-4028-9c1e-2b3f4a5d6e7f card 4111 1111 1111 1111')).toEqual(['CARD_NUMBER']);
  });
});
