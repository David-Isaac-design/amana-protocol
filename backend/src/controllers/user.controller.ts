import { Response, NextFunction } from "express";
import { AuthRequest } from "../services/auth.service";
import { findOrCreateUser, updateUser, updateDisplayName, getPublicProfile } from "../services/user.service";
import { AppError, ErrorCode } from "../errors/errorCodes";

/**
 * Get current user profile.
 * GET /users/me
 */
export async function getMe(req: AuthRequest, res: Response, next: NextFunction) {
  const callerWalletAddress = req.user?.walletAddress;
  if (!callerWalletAddress) {
    return next(new AppError(ErrorCode.AUTH_ERROR, "Unauthorized", 401));
  }

  try {
    const user = await findOrCreateUser(callerWalletAddress);
    res.json(user);
  } catch (err) {
    next(err);
  }
}

/**
 * Update current user profile.
 * PUT /users/me
 */
export async function updateMe(req: AuthRequest, res: Response, next: NextFunction) {
  const callerWalletAddress = req.user?.walletAddress;
  if (!callerWalletAddress) {
    return next(new AppError(ErrorCode.AUTH_ERROR, "Unauthorized", 401));
  }

  try {
    const user = await updateUser(callerWalletAddress, req.body);
    res.json(user);
  } catch (err) {
    next(err);
  }
}

/**
 * Set the current user's display name.
 * PATCH /users/me
 */
export async function patchMe(req: AuthRequest, res: Response, next: NextFunction) {
  const callerWalletAddress = req.user?.walletAddress;
  if (!callerWalletAddress) {
    return next(new AppError(ErrorCode.AUTH_ERROR, "Unauthorized", 401));
  }

  const body = req.body ?? {};
  const unknownKeys = Object.keys(body).filter((key) => key !== "displayName");
  if (unknownKeys.length > 0) {
    return next(new AppError(ErrorCode.VALIDATION_ERROR, `Unsupported field(s): ${unknownKeys.join(", ")}`, 400));
  }

  try {
    const user = await updateDisplayName(callerWalletAddress, body.displayName);
    res.json(user);
  } catch (err) {
    next(err);
  }
}

/**
 * Get public profile by address.
 * GET /users/:address
 */
export async function getUserByAddress(req: AuthRequest, res: Response, next: NextFunction) {
  const raw = req.params.address;
  const address = Array.isArray(raw) ? raw[0] : raw;

  if (!address) {
    return next(new AppError(ErrorCode.VALIDATION_ERROR, "Wallet address is required", 400));
  }

  try {
    const user = await getPublicProfile(address);
    if (!user) {
      throw new AppError(ErrorCode.NOT_FOUND, "User not found", 404);
    }
    res.json(user);
  } catch (err) {
    next(err);
  }
}
