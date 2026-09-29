import { formatAmount } from './formatAmount';

describe('formatAmount', () => {
  // USDC — 2 dp, thousands-separated
  it('formats USDC with 2 decimal places', () => {
    expect(formatAmount('1234.5', 'USDC')).toBe('1,234.50');
  });

  it('formats USDC whole number', () => {
    expect(formatAmount(1000, 'USDC')).toBe('1,000.00');
  });

  it('formats USDC string already at 2 dp', () => {
    expect(formatAmount('99.99', 'USDC')).toBe('99.99');
  });

  it('formats USDC large amount', () => {
    expect(formatAmount('1234567.89', 'USDC')).toBe('1,234,567.89');
  });

  // cNGN — treated like USDC (fiat-like, 2 dp)
  it('formats cNGN with 2 decimal places', () => {
    expect(formatAmount('500000', 'cNGN')).toBe('500,000.00');
  });

  it('formats cNGN case-insensitive', () => {
    expect(formatAmount('100', 'CNGN')).toBe('100.00');
  });

  // XLM — up to 7 dp, trailing zeros stripped
  it('formats XLM stripping trailing zeros', () => {
    expect(formatAmount('0.1234567', 'XLM')).toBe('0.1234567');
  });

  it('formats XLM strips unnecessary trailing zeros', () => {
    expect(formatAmount('1.5000000', 'XLM')).toBe('1.5');
  });

  it('formats XLM whole number', () => {
    expect(formatAmount('100', 'XLM')).toBe('100');
  });

  // Unknown asset — 2 dp fallback
  it('falls back to 2 dp for unknown asset', () => {
    expect(formatAmount('42', 'WEIRD')).toBe('42.00');
  });

  // Edge cases
  it('handles numeric input', () => {
    expect(formatAmount(0, 'USDC')).toBe('0.00');
  });

  it('handles string with existing commas', () => {
    expect(formatAmount('1,000.5', 'USDC')).toBe('1,000.50');
  });

  it('returns raw value for non-numeric input', () => {
    expect(formatAmount('abc', 'USDC')).toBe('abc');
  });
});
