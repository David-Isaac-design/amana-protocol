import request from "supertest";
import express from "express";
import { createStellarAccountBalanceRouter } from "../routes/stellar.account.balance";

const mockLoadAccount = jest.fn();

jest.mock("../config/stellar", () => ({
  horizonServer: {
    loadAccount: (...args: unknown[]) => mockLoadAccount(...args),
  },
  sorobanRpcClient: {},
  networkPassphrase: "Test SDF Network ; September 2015",
}));

jest.mock("../middleware/logger", () => ({
  appLogger: { error: jest.fn(), debug: jest.fn(), info: jest.fn(), warn: jest.fn() },
}));

const VALID_ADDRESS = "GDDD3FRCH55BSYNKISYY242HQNIBOH35CQP42NSJABR62XK2JOV5MED6";
const MALFORMED_ADDRESS = "not-a-valid-stellar-address";

const CNGN_ISSUER = "GCQELQQKJUKSL76P2RSEEP32CNXKPQEHHV6QBNMXETVBVJJCLXZAXMPK";

const FUNDED_ACCOUNT_BALANCES = [
  {
    asset_type: "native",
    balance: "100.0000000",
  },
  {
    asset_type: "credit_alphanum4",
    asset_code: "USDC",
    asset_issuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
    balance: "50.0000000",
    limit: "922337203685.4775807",
    is_authorized: true,
  },
  {
    asset_type: "credit_alphanum4",
    asset_code: "cNGN",
    asset_issuer: CNGN_ISSUER,
    balance: "200.0000000",
    limit: "10000.0000000",
    is_authorized: true,
  },
];

const BALANCES_WITHOUT_CNGN = [
  {
    asset_type: "native",
    balance: "5.0000000",
  },
];

const BALANCES_UNAUTHORIZED_CNGN = [
  {
    asset_type: "native",
    balance: "5.0000000",
  },
  {
    asset_type: "credit_alphanum4",
    asset_code: "cNGN",
    asset_issuer: CNGN_ISSUER,
    balance: "0.0000000",
    limit: "10000.0000000",
    is_authorized: false,
  },
];

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/stellar/account", createStellarAccountBalanceRouter());
  return app;
}

describe("GET /stellar/account/:address/balance", () => {
  let app: express.Application;

  beforeEach(() => {
    mockLoadAccount.mockReset();
    app = buildApp();
  });

  it("returns balances for a funded account", async () => {
    mockLoadAccount.mockResolvedValue({ balances: FUNDED_ACCOUNT_BALANCES });

    const res = await request(app).get(`/stellar/account/${VALID_ADDRESS}/balance`);

    expect(res.status).toBe(200);
    expect(res.body.address).toBe(VALID_ADDRESS);
    expect(res.body.balances).toHaveLength(3);

    const xlm = res.body.balances.find((b: any) => b.assetCode === "XLM");
    expect(xlm).toBeDefined();
    expect(xlm.assetType).toBe("native");
    expect(xlm.issuer).toBeNull();
    expect(xlm.balance).toBe("100.0000000");

    const usdc = res.body.balances.find((b: any) => b.assetCode === "USDC");
    expect(usdc).toBeDefined();
    expect(usdc.issuer).toBeTruthy();
    expect(usdc.limit).toBeTruthy();
  });

  it("returns 200 with empty balances for an unfunded account", async () => {
    mockLoadAccount.mockRejectedValue({ response: { status: 404 } });

    const res = await request(app).get(`/stellar/account/${VALID_ADDRESS}/balance`);

    expect(res.status).toBe(200);
    expect(res.body.address).toBe(VALID_ADDRESS);
    expect(res.body.balances).toHaveLength(0);
  });

  it("returns 400 for a malformed address", async () => {
    const res = await request(app).get(`/stellar/account/${MALFORMED_ADDRESS}/balance`);

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 502 when Horizon fails with a non-404 error", async () => {
    mockLoadAccount.mockRejectedValue(new Error("Network timeout"));

    const res = await request(app).get(`/stellar/account/${VALID_ADDRESS}/balance`);

    expect(res.status).toBe(502);
    expect(res.body).toHaveProperty("error");
  });

  // Issue #33 — cNGN trustline details
  it("returns hasTrustline=true, limit and authorized=true for account with cNGN trustline", async () => {
    mockLoadAccount.mockResolvedValue({ balances: FUNDED_ACCOUNT_BALANCES });

    const res = await request(app).get(`/stellar/account/${VALID_ADDRESS}/balance`);

    expect(res.status).toBe(200);
    expect(res.body.trustline).toBeDefined();
    expect(res.body.trustline.hasTrustline).toBe(true);
    expect(res.body.trustline.limit).toBe("10000.0000000");
    expect(res.body.trustline.authorized).toBe(true);
  });

  it("returns hasTrustline=false when the account has no cNGN trustline", async () => {
    mockLoadAccount.mockResolvedValue({ balances: BALANCES_WITHOUT_CNGN });

    const res = await request(app).get(`/stellar/account/${VALID_ADDRESS}/balance`);

    expect(res.status).toBe(200);
    expect(res.body.trustline).toBeDefined();
    expect(res.body.trustline.hasTrustline).toBe(false);
    expect(res.body.trustline.limit).toBeNull();
    expect(res.body.trustline.authorized).toBe(false);
  });

  it("returns hasTrustline=true and authorized=false for a frozen/unauthorised trustline", async () => {
    mockLoadAccount.mockResolvedValue({ balances: BALANCES_UNAUTHORIZED_CNGN });

    const res = await request(app).get(`/stellar/account/${VALID_ADDRESS}/balance`);

    expect(res.status).toBe(200);
    expect(res.body.trustline.hasTrustline).toBe(true);
    expect(res.body.trustline.authorized).toBe(false);
  });

  it("returns trustline hasTrustline=false for unfunded account", async () => {
    mockLoadAccount.mockRejectedValue({ response: { status: 404 } });

    const res = await request(app).get(`/stellar/account/${VALID_ADDRESS}/balance`);

    expect(res.status).toBe(200);
    expect(res.body.trustline).toEqual({ hasTrustline: false, limit: null, authorized: false });
  });
});
