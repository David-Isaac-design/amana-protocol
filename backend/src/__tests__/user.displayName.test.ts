import { Keypair } from "@stellar/stellar-sdk";
import { ErrorCode } from "../errors/errorCodes";

jest.mock("../lib/supabase", () => ({ getSupabaseClient: jest.fn() }));

import { getSupabaseClient } from "../lib/supabase";
import { patchDisplayNameSchema, sanitizeDisplayName } from "../validators/user.validators";
import { updateDisplayName } from "../services/user.service";
import { patchMe } from "../controllers/user.controller";

describe("display name validation", () => {
  it("accepts names between 2 and 40 characters", () => {
    expect(patchDisplayNameSchema.safeParse({ displayName: "Al" }).success).toBe(true);
    expect(patchDisplayNameSchema.safeParse({ displayName: "a".repeat(40) }).success).toBe(true);
  });

  it("rejects names shorter than 2 or longer than 40 characters", () => {
    expect(patchDisplayNameSchema.safeParse({ displayName: "A" }).success).toBe(false);
    expect(patchDisplayNameSchema.safeParse({ displayName: "a".repeat(41) }).success).toBe(false);
  });

  it("sanitizes markup, control characters and whitespace before length checks", () => {
    expect(sanitizeDisplayName("  <b>Ada</b>\u0000  Lovelace​ ")).toBe("Ada Lovelace");
    expect(sanitizeDisplayName("<script>alert(1)</script>")).toBe("alert(1)");
    // Whitespace-only or tag-only input collapses below the minimum length.
    expect(patchDisplayNameSchema.safeParse({ displayName: "   " }).success).toBe(false);
    expect(patchDisplayNameSchema.safeParse({ displayName: "<i></i>" }).success).toBe(false);
  });

  it("rejects unknown fields and non-string values", () => {
    expect(patchDisplayNameSchema.safeParse({ displayName: "Ada", isAdmin: true }).success).toBe(false);
    expect(patchDisplayNameSchema.safeParse({ displayName: 42 }).success).toBe(false);
  });
});

describe("updateDisplayName", () => {
  const wallet = Keypair.random().publicKey();
  let supabase: any;

  beforeEach(() => {
    supabase = {
      from: jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      single: jest.fn(),
    };
    (getSupabaseClient as jest.Mock).mockReturnValue(supabase);
  });

  it("persists the sanitized display name", async () => {
    supabase.single.mockResolvedValue({ data: { address: wallet.toLowerCase(), display_name: "Ada Lovelace" }, error: null });

    const result = await updateDisplayName(wallet, "  <b>Ada</b>   Lovelace ");

    expect(supabase.update).toHaveBeenCalledWith(expect.objectContaining({ display_name: "Ada Lovelace" }));
    expect(supabase.eq).toHaveBeenCalledWith("address", wallet.toLowerCase());
    expect(result.display_name).toBe("Ada Lovelace");
  });

  it("returns a 400 validation error without touching the database", async () => {
    await expect(updateDisplayName(wallet, "x")).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_ERROR,
      statusCode: 400,
    });
    expect(supabase.update).not.toHaveBeenCalled();
  });

  it("returns 404 when the user does not exist", async () => {
    supabase.single.mockResolvedValue({ data: null, error: { code: "PGRST116" } });
    await expect(updateDisplayName(wallet, "Ada")).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe("PATCH /users/me controller", () => {
  const wallet = Keypair.random().publicKey();

  function run(body: unknown, user: unknown = { walletAddress: wallet }) {
    const req: any = { body, user };
    const res: any = { json: jest.fn() };
    const next = jest.fn();
    return patchMe(req, res, next).then(() => ({ res, next }));
  }

  beforeEach(() => {
    (getSupabaseClient as jest.Mock).mockReturnValue({
      from: jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: { display_name: "Ada" }, error: null }),
    });
  });

  it("responds with the updated profile", async () => {
    const { res, next } = await run({ displayName: "Ada" });
    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ display_name: "Ada" });
  });

  it("rejects unauthenticated callers", async () => {
    const { next } = await run({ displayName: "Ada" }, null);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
  });

  it("rejects fields other than displayName", async () => {
    const { next } = await run({ displayName: "Ada", avatarUrl: "https://x.test/a.png" });
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: ErrorCode.VALIDATION_ERROR, statusCode: 400 }));
  });
});
