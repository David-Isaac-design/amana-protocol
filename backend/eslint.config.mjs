import tseslint from "typescript-eslint";
import eslint from "@eslint/js";

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: "module",
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "warn",
      // Use appLogger (src/middleware/logger.ts) so output is PII-redacted and
      // carries correlation IDs.
      "no-console": ["error", { allow: ["warn", "error"] }],
      // Money never becomes a JS number: above 2^53 stroops a double cannot
      // hold the value, so the DB row and the chain state drift apart with no
      // error anywhere. Use src/lib/money.ts — parseDecimalToStroops for
      // bigint arithmetic, formatStroopsToDecimal on the way back out.
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "CallExpression[callee.name='Number'] > MemberExpression[property.name=/^(amount|.*Amount|amountUsdc|.*AmountUsdc|price|.*Price|balance|.*Balance|fee|.*Fee|total|.*Total)$/]",
          message:
            "Do not convert a monetary field to a JS number — precision is lost above 2^53 stroops. Use parseDecimalToStroops from src/lib/money.ts.",
        },
        {
          selector:
            "CallExpression[callee.name=/^(parseFloat|parseInt)$/] > MemberExpression[property.name=/^(amount|.*Amount|amountUsdc|.*AmountUsdc|price|.*Price|balance|.*Balance|fee|.*Fee)$/]",
          message:
            "Do not parse a monetary field as a JS number — precision is lost above 2^53 stroops. Use parseDecimalToStroops from src/lib/money.ts.",
        },
        {
          selector:
            "BinaryExpression[operator=/^[+\\-*/%]$/] > MemberExpression[property.name=/^(amountUsdc|.*AmountUsdc|amountStroops|.*AmountStroops)$/]",
          message:
            "Do not do arithmetic directly on a monetary field — convert with parseDecimalToStroops from src/lib/money.ts and work in bigint stroops.",
        },
      ],
    },
  },
  {
    // The conversion module and its tests are the one place that is allowed to
    // move money between representations.
    files: ["src/lib/money.ts", "src/lib/__tests__/money.test.ts"],
    rules: {
      "no-restricted-syntax": "off",
    },
  },
  {
    files: ["src/__tests__/**", "src/services/__tests__/**", "src/config/__tests__/**"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  {
    files: ["src/config/tracing.ts"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  {
    // Tests and CLI scripts print to stdout on purpose.
    files: ["src/**/__tests__/**", "src/**/*.test.ts", "src/scripts/**", "src/lib/outbox/outbox.lint.ts"],
    rules: {
      "no-console": "off",
    },
  },
  {
    ignores: ["dist/**", "node_modules/**", "coverage/**"],
  },
);
