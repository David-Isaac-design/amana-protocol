import { createQueryString } from "../client";

describe("createQueryString", () => {
  it("returns an empty string when there are no params", () => {
    expect(createQueryString()).toBe("");
    expect(createQueryString({})).toBe("");
  });

  it("builds a leading-? query string from provided params", () => {
    expect(createQueryString({ status: "OPEN", page: 2, limit: 10 })).toBe(
      "?status=OPEN&page=2&limit=10",
    );
  });

  it("omits keys whose value is undefined or an empty string", () => {
    expect(createQueryString({ status: undefined, page: 1, limit: "" })).toBe("?page=1");
  });

  it("coerces numeric values to strings in the query", () => {
    const query = createQueryString({ page: 3 });
    expect(query).toBe("?page=3");
  });
});

describe("request error messages", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  function mockResponse(status: number, body: unknown) {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status,
      statusText: "Bad Request",
      json: async () => body,
    }) as unknown as typeof fetch;
  }

  it("surfaces the backend `message` field (e.g. the pilot trade cap)", async () => {
    const { request } = await import("../client");
    mockResponse(400, {
      code: "TRADE_AMOUNT_EXCEEDS_PILOT_CAP",
      message: "Trade amount exceeds the pilot limit of 500 USDC. Please enter 500 USDC or less.",
    });
    await expect(request("/trades", { method: "POST", skipAuth: true })).rejects.toMatchObject({
      status: 400,
      message: "Trade amount exceeds the pilot limit of 500 USDC. Please enter 500 USDC or less.",
    });
  });

  it("still prefers a legacy `error` field", async () => {
    const { request } = await import("../client");
    mockResponse(400, { error: "legacy error", message: "ignored" });
    await expect(request("/trades", { skipAuth: true })).rejects.toMatchObject({ message: "legacy error" });
  });

  it("falls back to the status text when the body has neither", async () => {
    const { request } = await import("../client");
    mockResponse(400, null);
    await expect(request("/trades", { skipAuth: true })).rejects.toMatchObject({ message: "Bad Request" });
  });
});
