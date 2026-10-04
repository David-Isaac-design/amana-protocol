import { validateStep1, validateStep2 } from "../validation";

jest.mock("@stellar/stellar-sdk", () => ({
  StrKey: {
    isValidEd25519PublicKey: jest.fn((address: string) => {
      return (address.startsWith("G") || address.startsWith("M")) && address.length >= 40;
    }),
  },
}));

const validSellerAddress = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

describe("validateStep1", () => {
  const validBase = {
    commodity: "Maize",
    quantity: "10",
    unit: "kg",
    pricePerUnit: "1500",
    currency: "NGN",
    sellerAddress: validSellerAddress,
  };

  it.each([
    ["quantity just below minimum", { quantity: "0" }, ["quantity"]],
    ["quantity exactly at minimum boundary", { quantity: "0.0001" }, []],
    ["price just below minimum", { pricePerUnit: "0" }, ["pricePerUnit"]],
    ["price exactly at minimum boundary", { pricePerUnit: "0.0001" }, []],
    ["empty seller address", { sellerAddress: "" }, ["sellerAddress"]],
    ["invalid seller address format", { sellerAddress: "not-a-valid-key" }, ["sellerAddress"]],
  ])("handles %s", (_, overrides, expectedFields) => {
    const errors = validateStep1({ ...validBase, ...overrides });

    if (expectedFields.length === 0) {
      expect(errors).toEqual({});
      return;
    }

    expect(Object.keys(errors)).toEqual(expect.arrayContaining(expectedFields));
  });

  it("accepts valid interior quantity and price values", () => {
    const errors = validateStep1({
      ...validBase,
      quantity: "25.5",
      pricePerUnit: "1250.25",
    });

    expect(errors).toEqual({});
  });
});

describe("validateStep2", () => {
  it.each([
    ["boundary sum at 0/100", { buyerRatio: 0, sellerRatio: 100, deliveryDays: "1" }, []],
    ["valid interior split", { buyerRatio: 25, sellerRatio: 75, deliveryDays: "7" }, []],
    ["boundary sum at 100/0", { buyerRatio: 100, sellerRatio: 0, deliveryDays: "90" }, []],
    ["sum just below accepted boundary", { buyerRatio: 50, sellerRatio: 49, deliveryDays: "7" }, ["sum"]],
    ["sum just above accepted boundary", { buyerRatio: 50, sellerRatio: 51, deliveryDays: "7" }, ["sum"]],
    ["buyer ratio below minimum", { buyerRatio: -1, sellerRatio: 101, deliveryDays: "7" }, ["buyerRatio", "sellerRatio"]],
    ["buyer ratio above maximum", { buyerRatio: 101, sellerRatio: -1, deliveryDays: "7" }, ["buyerRatio", "sellerRatio"]],
    ["delivery window just below minimum", { buyerRatio: 50, sellerRatio: 50, deliveryDays: "0" }, ["deliveryDays"]],
    ["delivery window at minimum", { buyerRatio: 50, sellerRatio: 50, deliveryDays: "1" }, []],
    ["delivery window at maximum", { buyerRatio: 50, sellerRatio: 50, deliveryDays: "90" }, []],
    ["delivery window just above maximum", { buyerRatio: 50, sellerRatio: 50, deliveryDays: "91" }, ["deliveryDays"]],
  ])("handles %s", (_, data, expectedKeys) => {
    const errors = validateStep2(data as { buyerRatio: number; sellerRatio: number; deliveryDays: string });

    if (expectedKeys.length === 0) {
      expect(errors).toEqual({});
      return;
    }

    expect(Object.keys(errors)).toEqual(expect.arrayContaining(expectedKeys));
  });
});
