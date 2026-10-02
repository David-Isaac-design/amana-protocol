import { t } from "@/lib/i18n";
import {
  formatNaira,
  formatMoney,
  formatNumber,
  formatCngnAmount,
  formatDate,
  formatRelativeTime,
} from "@/lib/i18n/format";
import { pseudoLocalize } from "@/lib/i18n/pseudo";

describe("formatNaira", () => {
  it("renders NGN as ₦1,234.56", () => {
    expect(formatNaira(1234.56)).toBe("₦1,234.56");
  });

  it("accepts string amounts", () => {
    expect(formatNaira("1000")).toBe("₦1,000.00");
  });

  it("groups large amounts", () => {
    expect(formatNaira(2_500_000)).toBe("₦2,500,000.00");
  });

  it("throws on non-numeric input", () => {
    expect(() => formatNaira("not-a-number")).toThrow(RangeError);
  });
});

describe("formatMoney", () => {
  it("honours an explicit currency", () => {
    expect(formatMoney(1234.56, { currency: "USD", locale: "en-US" })).toBe("$1,234.56");
  });
});

describe("formatNumber", () => {
  it("groups with the en-NG locale", () => {
    expect(formatNumber(1234567.89, { maximumFractionDigits: 2 })).toBe("1,234,567.89");
  });
});

describe("formatCngnAmount", () => {
  it("groups amounts and consistently displays two fraction digits", () => {
    expect(formatCngnAmount(1234567)).toBe("1,234,567.00");
    expect(formatCngnAmount("1234.5")).toBe("1,234.50");
  });
});

describe("formatDate", () => {
  it("uses day-month-year order for en-NG", () => {
    expect(formatDate(new Date("2026-08-29T12:00:00Z"), { locale: "en-NG" })).toBe(
      "29 Aug 2026",
    );
  });
});

describe("formatRelativeTime", () => {
  it("describes the past", () => {
    const now = new Date("2026-08-29T12:00:00Z");
    const earlier = new Date("2026-08-26T12:00:00Z");
    expect(formatRelativeTime(earlier, { now, locale: "en-US" })).toBe("3 days ago");
  });
});

describe("t()", () => {
  it("resolves a catalog key", () => {
    expect(t("common.retry")).toBe("Retry");
  });

  it("interpolates params", () => {
    expect(t("wallet.wrongNetworkCta", { expected: "Testnet" })).toBe("Switch to Testnet");
  });

  it("returns the key when missing", () => {
    // @ts-expect-error deliberately unknown key
    expect(t("does.not.exist")).toBe("does.not.exist");
  });

  it("pseudo-localizes when locale is pseudo", () => {
    const out = t("common.retry", { locale: "pseudo" });
    expect(out).toMatch(/^⟦/);
    expect(out).toContain("Ŕéţŕý");
  });
});

describe("pseudoLocalize", () => {
  it("preserves ICU placeholders", () => {
    expect(pseudoLocalize("Hello {name}")).toContain("{name}");
  });

  it("pads the string so truncation is visible", () => {
    expect(pseudoLocalize("Save").length).toBeGreaterThan("Save".length);
  });
});
