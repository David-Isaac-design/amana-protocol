import { appUrlForPath, screenForPath, webUrlForTrade } from "@/lib/links";

describe("web <-> app link mapping", () => {
  it("maps a trade detail path to the app scheme URL", () => {
    expect(appUrlForPath("/trades/T-123")).toBe("amanavault://trades/T-123");
    expect(screenForPath("/trades/T-123")).toBe("TradeDetail");
  });

  it("maps dispute + evidence + list paths", () => {
    expect(appUrlForPath("/disputes/D9")).toBe("amanavault://disputes/D9");
    expect(appUrlForPath("/trades/T1/evidence")).toBe("amanavault://evidence/T1");
    expect(appUrlForPath("/trades")).toBe("amanavault://trades");
  });

  it("returns null for non-deep-linkable paths", () => {
    expect(appUrlForPath("/dashboard")).toBeNull();
    expect(screenForPath("/settings")).toBeNull();
  });

  it("builds a shareable web URL for a trade", () => {
    expect(webUrlForTrade("T-123")).toBe("https://example.com/trades/T-123");
  });
});
