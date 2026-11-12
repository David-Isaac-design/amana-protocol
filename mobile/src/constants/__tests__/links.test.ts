import { parseDeepLink, webUrlFor, requiresAuth } from '../links';

describe('parseDeepLink', () => {
  it('parses a universal link to a trade', () => {
    expect(parseDeepLink('https://example.com/trades/T-123')).toEqual({
      screen: 'TradeDetail',
      params: { tradeId: 'T-123' },
    });
  });

  it('parses a custom-scheme link to a trade (cold start payload)', () => {
    expect(parseDeepLink('amanavault://trades/T-123')).toEqual({
      screen: 'TradeDetail',
      params: { tradeId: 'T-123' },
    });
  });

  it('parses a bare path (warm start / notification data)', () => {
    expect(parseDeepLink('/disputes/D9')).toEqual({
      screen: 'DisputeDetail',
      params: { id: 'D9' },
    });
  });

  it('parses the trade list with no params', () => {
    expect(parseDeepLink('https://example.com/trades')).toEqual({ screen: 'TradeList' });
  });

  it('parses an evidence-capture universal link', () => {
    expect(parseDeepLink('https://example.com/trades/T1/evidence')).toEqual({
      screen: 'EvidenceCapture',
      params: { tradeId: 'T1' },
    });
  });

  it('returns null for malformed / unknown links', () => {
    expect(parseDeepLink('https://example.com/nope/here')).toBeNull();
    expect(parseDeepLink('not a url')).toBeNull();
    expect(parseDeepLink('')).toBeNull();
    expect(parseDeepLink(null)).toBeNull();
  });

  it('treats a trailing-slash trades path as the list', () => {
    expect(parseDeepLink('amanavault://trades/')).toEqual({ screen: 'TradeList' });
  });

  it('round-trips to a public web URL', () => {
    const target = parseDeepLink('amanavault://trades/T-123')!;
    expect(webUrlFor(target)).toBe('https://example.com/trades/T-123');
  });

  it('flags auth requirement per screen', () => {
    expect(requiresAuth({ screen: 'TradeDetail' })).toBe(true);
    expect(requiresAuth({ screen: 'WalletConnect' })).toBe(false);
  });
});
