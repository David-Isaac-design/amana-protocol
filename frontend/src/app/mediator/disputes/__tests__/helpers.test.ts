import {
  getMediatorAddresses,
  isMediatorAddress,
  formatDate,
  formatAddress,
  getDisputeAgeHours,
  isBreachingSLA,
  formatAge,
  SLA_THRESHOLD_HOURS,
} from "../helpers";

describe("getMediatorAddresses", () => {
  it("falls back to the dev default when no env value is set", () => {
    expect(getMediatorAddresses(undefined)).toEqual(["GEXAMPLEMEDIATORPUBLICKEY1"]);
  });

  it("falls back to the dev default when the env value is empty", () => {
    expect(getMediatorAddresses("")).toEqual(["GEXAMPLEMEDIATORPUBLICKEY1"]);
  });

  it("parses a comma-separated allowlist and trims whitespace", () => {
    expect(getMediatorAddresses("GABC123, GDEF456 ,GHI789")).toEqual([
      "GABC123",
      "GDEF456",
      "GHI789",
    ]);
  });

  it("drops empty entries produced by trailing commas", () => {
    expect(getMediatorAddresses("GABC123,,")).toEqual(["GABC123"]);
  });
});

describe("isMediatorAddress", () => {
  const allowlist = ["GABC123", "GDEF456"];

  it("returns true when the address is on the allowlist", () => {
    expect(isMediatorAddress("GABC123", allowlist)).toBe(true);
  });

  it("returns false when the address is not on the allowlist", () => {
    expect(isMediatorAddress("GNOTALLOWED", allowlist)).toBe(false);
  });

  it("returns false for null or undefined addresses", () => {
    expect(isMediatorAddress(null, allowlist)).toBe(false);
    expect(isMediatorAddress(undefined, allowlist)).toBe(false);
  });
});

describe("formatDate", () => {
  it("formats an ISO string as 'Mon D, YYYY'", () => {
    expect(formatDate("2026-01-05T00:00:00Z")).toBe("Jan 5, 2026");
  });
});

describe("formatAddress", () => {
  it("truncates long addresses to the first 6 and last 4 characters", () => {
    expect(formatAddress("GABCDEFGHIJKLMNOPQRSTUVWXYZ")).toBe("GABCDE...WXYZ");
  });

  it("passes short addresses through untouched", () => {
    expect(formatAddress("GSHORT")).toBe("GSHORT");
  });

  it("passes addresses exactly at the 12-character boundary through untouched", () => {
    expect(formatAddress("123456789012")).toBe("123456789012");
  });
});

describe("SLA_THRESHOLD_HOURS", () => {
  it("is 72 hours", () => {
    expect(SLA_THRESHOLD_HOURS).toBe(72);
  });
});

describe("getDisputeAgeHours", () => {
  it("returns 0 for a dispute created at the reference time", () => {
    const now = new Date("2026-01-10T12:00:00Z").getTime();
    expect(getDisputeAgeHours("2026-01-10T12:00:00Z", now)).toBe(0);
  });

  it("returns 24 for a dispute created exactly one day ago", () => {
    const now = new Date("2026-01-10T12:00:00Z").getTime();
    expect(getDisputeAgeHours("2026-01-09T12:00:00Z", now)).toBe(24);
  });

  it("returns 72 for a dispute created exactly 3 days ago", () => {
    const now = new Date("2026-01-10T12:00:00Z").getTime();
    expect(getDisputeAgeHours("2026-01-07T12:00:00Z", now)).toBe(72);
  });
});

describe("isBreachingSLA", () => {
  it("returns false when dispute age equals the SLA threshold exactly", () => {
    const now = new Date("2026-01-10T12:00:00Z").getTime();
    // exactly 72h old — not yet breaching (strict >)
    expect(isBreachingSLA("2026-01-07T12:00:00Z", now)).toBe(false);
  });

  it("returns true when dispute age exceeds the SLA threshold", () => {
    const now = new Date("2026-01-10T13:00:00Z").getTime();
    // 73h old
    expect(isBreachingSLA("2026-01-07T12:00:00Z", now)).toBe(true);
  });

  it("returns false for a dispute created recently", () => {
    const now = new Date("2026-01-10T12:00:00Z").getTime();
    // 1h old
    expect(isBreachingSLA("2026-01-10T11:00:00Z", now)).toBe(false);
  });
});

describe("formatAge", () => {
  const anchor = new Date("2026-01-10T12:00:00Z").getTime();

  it("returns '< 1m' for very recent disputes", () => {
    expect(formatAge("2026-01-10T11:59:30Z", anchor)).toBe("< 1m");
  });

  it("returns minutes for disputes less than an hour old", () => {
    expect(formatAge("2026-01-10T11:30:00Z", anchor)).toBe("30m");
  });

  it("returns hours and minutes for disputes between 1 and 24 hours old", () => {
    expect(formatAge("2026-01-10T09:45:00Z", anchor)).toBe("2h 15m");
  });

  it("returns only hours when minutes are 0", () => {
    expect(formatAge("2026-01-10T10:00:00Z", anchor)).toBe("2h");
  });

  it("returns days and hours for disputes older than a day", () => {
    expect(formatAge("2026-01-07T08:00:00Z", anchor)).toBe("3d 4h");
  });

  it("returns only days when hours are 0", () => {
    expect(formatAge("2026-01-07T12:00:00Z", anchor)).toBe("3d");
  });
});
