import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { Keypair, StrKey } from '@stellar/stellar-sdk';
import { Request } from 'express';
import { findOrCreateUser } from './user.service';
import { AppError, ErrorCode, isAppError } from '../errors/errorCodes';
import { env, runtimeEnvValue } from '../config/env';
import { redis } from '../lib/redis';
import { prisma } from '../lib/db';
import { AdminSessionService } from './adminSession.service';
import { appLogger } from '../middleware/logger';

const CHALLENGE_PREFIX = 'challenge:';
const REVOKED_PREFIX = 'revoked_jti:';
const TOKEN_VERSION_PREFIX = 'token_version:';
const REVOKED_FAMILY_PREFIX = 'revoked_family:';
const ROTATED_PREFIX = 'rotated_jti:';
const CHALLENGE_TTL = 300; // 5 min
const AUTH_FAILURE_PREFIX = 'auth:challenge-failures:';
const AUTH_LOCKOUT_THRESHOLD = 5;
const AUTH_FAILURE_WINDOW_SECONDS = 15 * 60;
const AUTH_LOCKOUT_SECONDS = 15 * 60;
// A refresh token can be expired briefly, but it must still be a recently
// issued access token. Keeping these limits here makes the exceptional refresh
// path deliberately narrower than normal JWT validation.
const REFRESH_EXPIRY_GRACE_SECONDS = 15 * 60;
const REFRESH_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;
// Two legitimate refreshes racing with the same token (e.g. two browser tabs)
// land within a few seconds of each other. Inside this window the loser is
// rejected without treating it as theft; outside it, reuse revokes the family.
const REFRESH_REUSE_GRACE_SECONDS = 10;

export interface JWTPayload {
  sub: string;
  walletAddress: string;
  jti: string;
  /** Token generation this JWT was issued against — see AuthService.bumpTokenVersion. */
  tv: number;
  /** Refresh-token family id; preserved across rotations. Absent on legacy tokens (jti is used). */
  fid?: string;
  iat?: number;
  exp?: number;
  iss?: string;
  aud?: string;
  nbf?: number;
  /** Set by adminMiddleware at runtime when the caller is on the ADMIN_STELLAR_PUBKEYS allowlist.
   *  Not present in the signed JWT — added to the in-memory request context after verification. */
  isAdmin?: boolean;
  /** Token tier. `admin` marks a device-bound admin token minted by
   *  /api/admin/auth/step-up (issue #198). Absent on ordinary wallet tokens. */
  tier?: 'admin';
  /** Device fingerprint hash the token is bound to (issue #198). */
  deviceHash?: string;
  /** Masked IP-prefix class the token is bound to (issue #198). */
  ipClass?: string;
}

export interface AuthRequest extends Request {
  user?: JWTPayload;
}

export class AuthService {
  static async generateChallenge(walletAddress: string): Promise<string> {
    if (!StrKey.isValidEd25519PublicKey(walletAddress)) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'Invalid Stellar public key', 400);
    }

    try {
      const challenge = crypto.randomBytes(32).toString('base64url');
      const key = `${CHALLENGE_PREFIX}${walletAddress.toLowerCase()}`;

      await redis.set(key, challenge, 'EX', CHALLENGE_TTL);
      return challenge;
    } catch (error: unknown) {
      if (isAppError(error)) throw error;
      throw new AppError(ErrorCode.INFRA_ERROR, 'Authentication service dependency failure', 503);
    }
  }

  static async verifySignatureAndIssueJWT(walletAddress: string, signedChallenge: string): Promise<string> {
    const identity = walletAddress.toLowerCase();
    const failureKey = `${AUTH_FAILURE_PREFIX}${identity}`;

    try {
      if (typeof (redis as any).getdel === 'function') {
        const failures = Number.parseInt((await redis.get(failureKey)) ?? '0', 10);
        if (Number.isFinite(failures) && failures >= AUTH_LOCKOUT_THRESHOLD) {
          throw new AppError(ErrorCode.AUTH_ERROR, 'Too many failed verification attempts; try again later', 429);
        }
      }

      const key = `${CHALLENGE_PREFIX}${identity}`;
      // Prefer atomic consumption in Redis; the fallback keeps lightweight test
      // and local Redis doubles compatible.
      const challenge = typeof (redis as any).getdel === 'function'
        ? await (redis as any).getdel(key)
        : await redis.get(key);

      if (!challenge) {
        throw new AppError(ErrorCode.AUTH_ERROR, 'Challenge expired or invalid. Request new challenge.', 401);
      }

      if (typeof (redis as any).getdel !== 'function') {
        const failures = Number.parseInt((await redis.get(failureKey)) ?? '0', 10);
        if (Number.isFinite(failures) && failures >= AUTH_LOCKOUT_THRESHOLD) {
          throw new AppError(ErrorCode.AUTH_ERROR, 'Too many failed verification attempts; try again later', 429);
        }
      }

      const publicKey = Keypair.fromPublicKey(walletAddress);
      let isValid = false;
      try {
        isValid = publicKey.verify(
          Buffer.from(challenge, "utf8"),
          Buffer.from(signedChallenge, "base64url"),
        );
      } catch (e) {
        isValid = false;
      }

      if (!isValid) {
        if (typeof (redis as any).getdel !== 'function') {
          await redis.del(key);
        }
        const currentFailures = Number.parseInt((await redis.get(failureKey)) ?? '0', 10);
        const nextFailures = Number.isFinite(currentFailures) ? currentFailures + 1 : 1;
        await redis.set(
          failureKey,
          String(nextFailures),
          'EX',
          nextFailures >= AUTH_LOCKOUT_THRESHOLD ? AUTH_LOCKOUT_SECONDS : AUTH_FAILURE_WINDOW_SECONDS,
        );
        throw new AppError(ErrorCode.AUTH_ERROR, 'Invalid signature', 401);
      }

      if (typeof (redis as any).getdel !== 'function') {
        await redis.del(key);
      }
      if (typeof (redis as any).getdel === 'function') {
        await redis.del(failureKey);
      } else {
        await redis.set(failureKey, '0', 'EX', 1);
      }

      // Ensure user exists
      await findOrCreateUser(walletAddress);

      return await this.issueToken(walletAddress);
    } catch (error: unknown) {
      if (isAppError(error)) throw error;
      throw new AppError(ErrorCode.INFRA_ERROR, 'Authentication service dependency failure', 503);
    }
  }

  static async validateToken(token: string): Promise<JWTPayload> {
    const secret = process.env.JWT_SECRET ?? env.JWT_SECRET;
    if (!secret) {
      throw new AppError(ErrorCode.INFRA_ERROR, 'JWT_SECRET not set', 500);
    }

    try {
      const decoded = jwt.verify(token, secret, {
        algorithms: ['HS256'],
        issuer: process.env.JWT_ISSUER ?? env.JWT_ISSUER,
        audience: process.env.JWT_AUDIENCE ?? env.JWT_AUDIENCE,
      }) as JWTPayload;

      if (!decoded.jti) {
        throw new AppError(ErrorCode.AUTH_ERROR, 'Unauthorized: missing jti claim', 401);
      }

      if (await this.isTokenRevoked(decoded.jti)) {
        throw new AppError(ErrorCode.AUTH_ERROR, 'Unauthorized: token has been revoked', 401);
      }

      if (decoded.fid && (await this.isFamilyRevoked(decoded.fid))) {
        throw new AppError(ErrorCode.AUTH_ERROR, 'Unauthorized: token has been revoked', 401);
      }

      // Tokens issued before a role/status change (or an incident-driven bulk
      // revoke) carry a stale generation number and must be rejected even
      // though the JWT signature and jti are still individually valid.
      const currentVersion = await this.getTokenVersion(decoded.walletAddress);
      if ((decoded.tv ?? 0) < currentVersion) {
        throw new AppError(ErrorCode.AUTH_ERROR, 'Unauthorized: token has been revoked', 401);
      }

      return decoded;
    } catch (error: unknown) {
      if (isAppError(error)) throw error;
      if (error instanceof jwt.TokenExpiredError) {
        throw new AppError(ErrorCode.AUTH_ERROR, 'Token expired', 401);
      }
      // NotBeforeError extends JsonWebTokenError, so this must be checked first
      // to surface a precise "not yet valid" message instead of the generic one.
      if (error instanceof jwt.NotBeforeError) {
        throw new AppError(ErrorCode.AUTH_ERROR, 'Token not yet valid', 401);
      }
      if (error instanceof jwt.JsonWebTokenError) {
        throw new AppError(ErrorCode.AUTH_ERROR, 'Invalid token', 401);
      }
      throw new AppError(ErrorCode.INFRA_ERROR, 'Token validation failed', 500);
    }
  }

  static async refreshToken(oldToken: string): Promise<string> {
    // For refresh, we allow slightly expired tokens if they are otherwise valid
    const secret = process.env.JWT_SECRET ?? env.JWT_SECRET;
    if (!secret) {
      throw new AppError(ErrorCode.INFRA_ERROR, 'JWT_SECRET not set', 500);
    }

    try {
      const decoded = jwt.verify(oldToken, secret, {
        algorithms: ['HS256'],
        issuer: process.env.JWT_ISSUER ?? env.JWT_ISSUER,
        audience: process.env.JWT_AUDIENCE ?? env.JWT_AUDIENCE,
        ignoreExpiration: true, // Expiration is checked explicitly against a short grace period below.
      }) as JWTPayload;

      if (
        !decoded.jti ||
        !decoded.walletAddress ||
        typeof decoded.iat !== 'number' ||
        !Number.isFinite(decoded.iat) ||
        typeof decoded.exp !== 'number' ||
        !Number.isFinite(decoded.exp)
      ) {
        throw new AppError(ErrorCode.AUTH_ERROR, 'Token refresh failed: invalid token claims', 401);
      }

      // A refreshed token must be both recently expired and recently issued.
      // This prevents a valid but arbitrarily old signed token from being used
      // as a renewable credential forever.
      const now = Math.floor(Date.now() / 1000);
      if (now > decoded.exp + REFRESH_EXPIRY_GRACE_SECONDS) {
        throw new AppError(ErrorCode.AUTH_ERROR, 'Token too old to refresh', 401);
      }
      if (decoded.iat > now + 60 || now - decoded.iat > REFRESH_MAX_AGE_SECONDS) {
        throw new AppError(ErrorCode.AUTH_ERROR, 'Token too old to refresh', 401);
      }

      const familyId = decoded.fid ?? decoded.jti;
      if (await this.isFamilyRevoked(familyId)) {
        throw new AppError(ErrorCode.AUTH_ERROR, 'Token revoked', 401);
      }

      // Atomically claim this token's single rotation. A second presentation
      // of an already-rotated token is reuse: either a benign race between two
      // legitimate refreshes, or a replay of a stolen token.
      const rotationTtl = Math.max(decoded.exp, now) + REFRESH_EXPIRY_GRACE_SECONDS - now;
      const claimed = await redis.set(`${ROTATED_PREFIX}${decoded.jti}`, String(now), 'EX', rotationTtl, 'NX');
      if (claimed === null) {
        const rotatedAt = Number.parseInt((await redis.get(`${ROTATED_PREFIX}${decoded.jti}`)) ?? '', 10);
        if (Number.isFinite(rotatedAt) && now - rotatedAt <= REFRESH_REUSE_GRACE_SECONDS) {
          throw new AppError(ErrorCode.AUTH_ERROR, 'Token refresh already in progress', 409);
        }
        await this.revokeFamily(familyId, decoded.walletAddress, decoded.jti);
        throw new AppError(ErrorCode.AUTH_ERROR, 'Token reuse detected; all sessions revoked', 401);
      }

      if (await this.isTokenRevoked(decoded.jti)) {
        throw new AppError(ErrorCode.AUTH_ERROR, 'Token revoked', 401);
      }

      // Keep the deny-list entry through the refresh grace window as well. An
      // already-expired token otherwise has no remaining normal TTL and could
      // be replayed repeatedly until its grace period ends.
      await this.revokeToken(
        decoded.jti,
        Math.max(decoded.exp, now) + REFRESH_EXPIRY_GRACE_SECONDS,
      );

      return await this.issueToken(decoded.walletAddress, familyId);
    } catch (error: unknown) {
      if (isAppError(error)) throw error;
      throw new AppError(ErrorCode.AUTH_ERROR, 'Token refresh failed', 401);
    }
  }

  /** Add a token's jti to the revocation denylist. TTL matches remaining token lifetime. */
  static async revokeToken(jti: string, expiresAt: number): Promise<void> {
    try {
      if (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt)) return;
      const ttl = expiresAt - Math.floor(Date.now() / 1000);
      if (ttl <= 0) return; // already expired — no need to store
      const key = `${REVOKED_PREFIX}${jti}`;
      await redis.set(key, '1', 'EX', ttl);
    } catch (error: unknown) {
      if (isAppError(error)) throw error;
      throw new AppError(ErrorCode.INFRA_ERROR, 'Revocation failed', 503);
    }
  }

  /** Returns true if the jti has been revoked. */
  static async isTokenRevoked(jti: string): Promise<boolean> {
    try {
      const key = `${REVOKED_PREFIX}${jti}`;
      return (await redis.exists(key)) === 1;
    } catch (error: unknown) {
      if (isAppError(error)) throw error;
      throw new AppError(ErrorCode.INFRA_ERROR, 'Revocation check failed', 503);
    }
  }

  /** Returns true if every token in the refresh family has been revoked. */
  static async isFamilyRevoked(familyId: string): Promise<boolean> {
    try {
      return (await redis.exists(`${REVOKED_FAMILY_PREFIX}${familyId}`)) === 1;
    } catch (error: unknown) {
      throw new AppError(ErrorCode.INFRA_ERROR, 'Revocation check failed', 503);
    }
  }

  /**
   * Revoke a whole refresh-token family after reuse of a rotated token, log
   * the user out everywhere, and emit a security audit event.
   */
  static async revokeFamily(familyId: string, walletAddress: string, reusedJti: string): Promise<void> {
    const tokenTtl = parseInt(process.env.JWT_EXPIRES_IN ?? env.JWT_EXPIRES_IN, 10) || 86400;
    try {
      await redis.set(`${REVOKED_FAMILY_PREFIX}${familyId}`, '1', 'EX', tokenTtl + REFRESH_EXPIRY_GRACE_SECONDS);
      // A thief may have started other families from the same wallet, so also
      // invalidate every outstanding token for this user.
      await this.bumpTokenVersion(walletAddress);
    } catch (error: unknown) {
      if (isAppError(error)) throw error;
      throw new AppError(ErrorCode.INFRA_ERROR, 'Revocation failed', 503);
    }

    try {
      await prisma.refreshToken.deleteMany({ where: { familyId } });
    } catch {
      // Redis is authoritative for revocation; persisted rows are best-effort.
    }

    appLogger.warn(
      {
        event: 'security.refresh_token_reuse',
        walletAddress: walletAddress.toLowerCase(),
        familyId,
        reusedJti,
      },
      'Refresh token reuse detected; token family revoked',
    );
  }

  /** Current token generation for a wallet. Tokens issued at an older generation are rejected. */
  static async getTokenVersion(walletAddress: string): Promise<number> {
    try {
      const raw = await redis.get(`${TOKEN_VERSION_PREFIX}${walletAddress.toLowerCase()}`);
      const parsed = raw ? parseInt(raw, 10) : 0;
      return Number.isFinite(parsed) ? parsed : 0;
    } catch (error: unknown) {
      throw new AppError(ErrorCode.INFRA_ERROR, 'Token version check failed', 503);
    }
  }

  /**
   * Bumps a wallet's token generation, immediately invalidating every JWT
   * issued before this call regardless of individual expiry — call this on
   * role/status/lock changes, or for incident-driven bulk revocation.
   */
  static async bumpTokenVersion(walletAddress: string): Promise<number> {
    try {
      return await (redis as any).incr(`${TOKEN_VERSION_PREFIX}${walletAddress.toLowerCase()}`);
    } catch (error: unknown) {
      throw new AppError(ErrorCode.INFRA_ERROR, 'Token version bump failed', 503);
    }
  }

  private static async issueToken(walletAddress: string, familyId?: string): Promise<string> {
    const secret = process.env.JWT_SECRET ?? env.JWT_SECRET;
    if (!secret) {
      throw new Error('JWT_SECRET not set');
    }

    const ttl = parseInt(process.env.JWT_EXPIRES_IN ?? env.JWT_EXPIRES_IN, 10) || 86400;
    const now = Math.floor(Date.now() / 1000);
    const jti = crypto.randomUUID();
    const tv = await this.getTokenVersion(walletAddress);

    const payload: JWTPayload = {
      sub: walletAddress.toLowerCase(),
      walletAddress: walletAddress.toLowerCase(),
      jti,
      tv,
      fid: familyId ?? jti,
      iss: process.env.JWT_ISSUER ?? env.JWT_ISSUER,
      aud: process.env.JWT_AUDIENCE ?? env.JWT_AUDIENCE,
      iat: now,
      nbf: now,
      exp: now + ttl,
    };

    return jwt.sign(payload, secret, { algorithm: 'HS256' });
  }

  /**
   * Mint a short-TTL admin token bound to a device context and register it in
   * the admin session registry (issue #198). The caller must already be an
   * authenticated admin; binding + rotation happens at /api/admin/auth/step-up.
   */
  static async issueAdminToken(
    walletAddress: string,
    ctx: { deviceHash: string; ipClass: string; userAgent?: string },
  ): Promise<{ token: string; jti: string; expiresAt: number }> {
    const secret = process.env.JWT_SECRET ?? env.JWT_SECRET;
    if (!secret) {
      throw new AppError(ErrorCode.INFRA_ERROR, 'JWT_SECRET not set', 500);
    }

    const ttl = runtimeEnvValue('ADMIN_BOUND_JWT_EXPIRES_IN');
    const now = Math.floor(Date.now() / 1000);
    const jti = crypto.randomUUID();
    const expiresAt = now + ttl;
    const wallet = walletAddress.toLowerCase();
    const tv = await this.getTokenVersion(wallet);

    const payload: JWTPayload = {
      sub: wallet,
      walletAddress: wallet,
      jti,
      tv,
      tier: 'admin',
      deviceHash: ctx.deviceHash,
      ipClass: ctx.ipClass,
      iss: process.env.JWT_ISSUER ?? env.JWT_ISSUER,
      aud: process.env.JWT_AUDIENCE ?? env.JWT_AUDIENCE,
      iat: now,
      nbf: now,
      exp: expiresAt,
    };

    const token = jwt.sign(payload, secret, { algorithm: 'HS256' });

    await AdminSessionService.register({
      jti,
      walletAddress: wallet,
      deviceHash: ctx.deviceHash,
      ipClass: ctx.ipClass,
      userAgent: ctx.userAgent ?? '',
      issuedAt: now,
      expiresAt,
      lastSeenAt: now,
    });

    return { token, jti, expiresAt };
  }
}
