jest.mock("../../lib/redis", () => ({ redis: {} }));
jest.mock("../../middleware/logger", () => ({ appLogger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() } }));
jest.mock("../trade.service", () => ({ TradeService: class {} }));
jest.mock("../contract.service", () => ({ ContractService: class {} }));

import * as StellarSdk from "@stellar/stellar-sdk";
import { ErrorCode } from "../../errors/errorCodes";
import {
  PILOT_TRADE_CAP_ENV,
  PILOT_TRADE_CAP_FLAG,
  PilotTradeCapExceededError,
  PilotTradeCapService,
  parsePilotCap,
} from "../pilot-trade-cap.service";
import { TradeController } from "../../controllers/trade.controller";

const flagsWith = (flag: { enabled: boolean } | null | Error) => ({
  getFlag: jest.fn(async () => {
    if (flag instanceof Error) throw flag;
    return flag ? { ...flag, updatedAt: new Date().toISOString() } : null;
  }),
});

const svc = (cap: string | undefined, flag: { enabled: boolean } | null | Error = null) =>
  new PilotTradeCapService(flagsWith(flag), { [PILOT_TRADE_CAP_ENV]: cap } as NodeJS.ProcessEnv);

describe("parsePilotCap", () => {
  it("treats unset or blank as no cap", () => {
    expect(parsePilotCap(undefined)).toBeNull();
    expect(parsePilotCap("   ")).toBeNull();
  });

  it("parses decimal USDC into stroops", () => {
    expect(parsePilotCap("500")).toBe(5_000_000_000n);
    expect(parsePilotCap("0.5")).toBe(5_000_000n);
  });

  it("rejects zero, negative and malformed values", () => {
    expect(() => parsePilotCap("0")).toThrow(RangeError);
    expect(() => parsePilotCap("-1")).toThrow();
    expect(() => parsePilotCap("abc")).toThrow();
  });
});

describe("PilotTradeCapService", () => {
  it("allows any amount when no cap is configured", async () => {
    await expect(svc(undefined).assertWithinCap("1000000")).resolves.toBeUndefined();
  });

  it("allows amounts up to and including the cap", async () => {
    await expect(svc("500").assertWithinCap("499.9999999")).resolves.toBeUndefined();
    await expect(svc("500").assertWithinCap("500")).resolves.toBeUndefined();
    await expect(svc("500").assertWithinCap("500.0000000")).resolves.toBeUndefined();
  });

  it("rejects one stroop over the cap with a clear message", async () => {
    const err = await svc("500").assertWithinCap("500.0000001").catch((e) => e);
    expect(err).toBeInstanceOf(PilotTradeCapExceededError);
    expect(err.code).toBe(ErrorCode.TRADE_AMOUNT_EXCEEDS_PILOT_CAP);
    expect(err.statusCode).toBe(400);
    expect(err.message).toBe(
      "Trade amount exceeds the pilot limit of 500 USDC. Please enter 500 USDC or less.",
    );
  });

  it("formats fractional caps without trailing zeros", async () => {
    const err = await svc("250.5").assertWithinCap("300").catch((e) => e);
    expect(err.message).toContain("250.5 USDC");
  });

  it("lifts the cap when the kill-switch flag is explicitly disabled", async () => {
    const flags = flagsWith({ enabled: false });
    const service = new PilotTradeCapService(flags, { [PILOT_TRADE_CAP_ENV]: "500" } as NodeJS.ProcessEnv);
    await expect(service.assertWithinCap("10000")).resolves.toBeUndefined();
    expect(flags.getFlag).toHaveBeenCalledWith(PILOT_TRADE_CAP_FLAG);
  });

  it("keeps the cap when the flag is enabled or missing", async () => {
    await expect(svc("500", { enabled: true }).assertWithinCap("501")).rejects.toBeInstanceOf(
      PilotTradeCapExceededError,
    );
    await expect(svc("500", null).assertWithinCap("501")).rejects.toBeInstanceOf(PilotTradeCapExceededError);
  });

  it("fails closed when the flag store is unavailable", async () => {
    await expect(svc("500", new Error("redis down")).assertWithinCap("501")).rejects.toBeInstanceOf(
      PilotTradeCapExceededError,
    );
  });

  it("does not consult the flag store when no cap is configured", async () => {
    const flags = flagsWith(null);
    await new PilotTradeCapService(flags, {} as NodeJS.ProcessEnv).assertWithinCap("1");
    expect(flags.getFlag).not.toHaveBeenCalled();
  });
});

describe("TradeController.createTrade with the pilot cap", () => {
  const buyerAddress = StellarSdk.Keypair.random().publicKey();
  const sellerAddress = StellarSdk.Keypair.random().publicKey();

  function run(amountUsdc: string, cap: string) {
    const tradeService = { createPendingTrade: jest.fn() };
    const contractService = {
      buildCreateTradeTx: jest.fn().mockResolvedValue({ tradeId: "1", unsignedXdr: "XDR" }),
    };
    const controller = new TradeController(tradeService as any, contractService as any, svc(cap));
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
    const next = jest.fn();
    const req = {
      user: { walletAddress: buyerAddress },
      body: { sellerAddress, amountUsdc, buyerLossBps: 5000, sellerLossBps: 5000 },
    };
    return controller.createTrade(req as any, res as any, next).then(() => ({ res, next, tradeService, contractService }));
  }

  it("rejects an over-cap trade before building any transaction", async () => {
    const { next, contractService, tradeService } = await run("1000", "500");
    const err = next.mock.calls[0][0];
    expect(err).toBeInstanceOf(PilotTradeCapExceededError);
    expect(contractService.buildCreateTradeTx).not.toHaveBeenCalled();
    expect(tradeService.createPendingTrade).not.toHaveBeenCalled();
  });

  it("creates a trade at the cap", async () => {
    const { res, next } = await run("500", "500");
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
  });
});
