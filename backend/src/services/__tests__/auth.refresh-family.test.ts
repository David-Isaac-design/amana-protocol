import jwt from 'jsonwebtoken';
import { Keypair } from '@stellar/stellar-sdk';
import { ErrorCode } from '../../errors/errorCodes';

// Minimal stateful Redis double: refresh rotation relies on SET NX semantics.
jest.mock('ioredis', () => {
  const store = new Map<string, string>();
  const m = {
    store,
    get: jest.fn(async (k: string) => store.get(k) ?? null),
    set: jest.fn(async (k: string, v: string, ...args: unknown[]) => {
      if (args.includes('NX') && store.has(k)) return null;
      store.set(k, v);
      return 'OK';
    }),
    del: jest.fn(async (k: string) => (store.delete(k) ? 1 : 0)),
    exists: jest.fn(async (k: string) => (store.has(k) ? 1 : 0)),
    incr: jest.fn(async (k: string) => {
      const next = Number.parseInt(store.get(k) ?? '0', 10) + 1;
      store.set(k, String(next));
      return next;
    }),
    on: jest.fn(),
  };
  const ctor = jest.fn().mockImplementation(() => m);
  (ctor as any)._instance = m;
  return ctor;
});

jest.mock('../../lib/db', () => ({
  prisma: { refreshToken: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) } },
}));

jest.mock('../user.service', () => ({ findOrCreateUser: jest.fn() }));

import Redis from 'ioredis';
import { prisma } from '../../lib/db';
import { appLogger } from '../../middleware/logger';
const { AuthService } = require('../auth.service');

describe('AuthService refresh token family', () => {
  const wallet = Keypair.random().publicKey().toLowerCase();
  const store = () => (Redis as any)._instance.store as Map<string, string>;

  function loginToken(jti = 'root-jti') {
    const now = Math.floor(Date.now() / 1000);
    return jwt.sign(
      { sub: wallet, walletAddress: wallet, jti, tv: 0, fid: jti, iat: now, exp: now + 3600, iss: 'amana', aud: 'amana-api' },
      'test-secret',
    );
  }

  beforeAll(() => {
    process.env.JWT_SECRET = 'test-secret';
    process.env.JWT_ISSUER = 'amana';
    process.env.JWT_AUDIENCE = 'amana-api';
  });

  beforeEach(() => {
    store().clear();
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  it('carries the family id forward across rotations', async () => {
    const t1 = await AuthService.refreshToken(loginToken());
    const t2 = await AuthService.refreshToken(t1);
    expect((jwt.decode(t1) as any).fid).toBe('root-jti');
    expect((jwt.decode(t2) as any).fid).toBe('root-jti');
  });

  it('revokes the whole family and logs the user out everywhere on reuse of a rotated token', async () => {
    const warn = jest.spyOn(appLogger, 'warn');
    const original = loginToken();
    const rotated = await AuthService.refreshToken(original);
    const next = await AuthService.refreshToken(rotated);

    // Replay the original token well after its rotation.
    jest.useFakeTimers({ now: Date.now() + 60_000 });
    await expect(AuthService.refreshToken(original)).rejects.toMatchObject({
      code: ErrorCode.AUTH_ERROR,
      statusCode: 401,
    });

    await expect(AuthService.validateToken(next)).rejects.toMatchObject({ code: ErrorCode.AUTH_ERROR });
    await expect(AuthService.refreshToken(next)).rejects.toMatchObject({ code: ErrorCode.AUTH_ERROR });
    // Tokens from other families (other devices) are invalidated too.
    await expect(AuthService.validateToken(loginToken('other-device'))).rejects.toMatchObject({
      code: ErrorCode.AUTH_ERROR,
    });

    expect(prisma.refreshToken.deleteMany).toHaveBeenCalledWith({ where: { familyId: 'root-jti' } });
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'security.refresh_token_reuse', familyId: 'root-jti' }),
      expect.any(String),
    );
  });

  it('treats two concurrent legitimate refreshes as a race, not theft', async () => {
    const original = loginToken();
    const results = await Promise.allSettled([
      AuthService.refreshToken(original),
      AuthService.refreshToken(original),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled') as PromiseFulfilledResult<string>[];
    const rejected = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toMatchObject({ statusCode: 409 });

    // The winner's session is intact and the family was not revoked.
    await expect(AuthService.validateToken(fulfilled[0].value)).resolves.toMatchObject({ fid: 'root-jti' });
    expect(prisma.refreshToken.deleteMany).not.toHaveBeenCalled();
  });
});
