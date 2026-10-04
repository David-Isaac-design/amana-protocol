jest.mock("@prisma/client", () => ({ PrismaClient: jest.fn(() => ({})) }));

import { seedPilotDemo } from "../seed";

function fakeClient(existingDispute: unknown = null) {
  return {
    user: { upsert: jest.fn() },
    trade: { upsert: jest.fn() },
    dispute: { findFirst: jest.fn().mockResolvedValue(existingDispute), create: jest.fn() },
  };
}

describe("seedPilotDemo", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it("seeds seller, buyer and mediator accounts plus demo trades", async () => {
    const client = fakeClient();
    const result = await seedPilotDemo(client as any);

    expect(client.user.upsert).toHaveBeenCalledTimes(3);
    expect(client.trade.upsert).toHaveBeenCalledTimes(2);
    expect(result.trades).toEqual(["demo_funded", "demo_disputed"]);
    const statuses = client.trade.upsert.mock.calls.map((c) => c[0].create.status);
    expect(statuses).toEqual(["FUNDED", "DISPUTED"]);
    expect(client.dispute.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ tradeId: "demo_disputed", initiator: result.buyer }),
    });
  });

  it("uses DEMO_*_ADDRESS overrides, stored lowercase", async () => {
    process.env.DEMO_SELLER_ADDRESS = " GSELLERADDRESS ";
    process.env.DEMO_BUYER_ADDRESS = "GBUYERADDRESS";
    process.env.DEMO_MEDIATOR_ADDRESS = "GMEDIATORADDRESS";
    const client = fakeClient();
    const result = await seedPilotDemo(client as any);

    expect(result).toMatchObject({
      seller: "gselleraddress",
      buyer: "gbuyeraddress",
      mediator: "gmediatoraddress",
    });
    const trade = client.trade.upsert.mock.calls[0][0].create;
    expect(trade).toMatchObject({ buyerAddress: "gbuyeraddress", sellerAddress: "gselleraddress" });
  });

  it("is idempotent: does not duplicate the demo dispute", async () => {
    const client = fakeClient({ id: 1 });
    await seedPilotDemo(client as any);
    expect(client.dispute.create).not.toHaveBeenCalled();
    expect(client.user.upsert.mock.calls[0][0]).toHaveProperty("where");
  });
});
