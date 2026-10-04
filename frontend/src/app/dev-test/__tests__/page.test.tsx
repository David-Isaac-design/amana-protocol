/**
 * Tests for the /dev-test page production guard (#53).
 *
 * In production builds the page must call notFound() so Next.js
 * returns a 404 response instead of rendering the fixture content.
 * In development/test environments the page renders normally.
 */

import { render, screen } from "@testing-library/react";

// next/navigation is mocked globally via jest setup; we only need notFound here.
// The real notFound() throws a special error to abort rendering — we replicate
// that behaviour so the component tree stops and the heading never reaches the DOM.
const mockNotFound = jest.fn(() => {
  throw new Error("NEXT_NOT_FOUND");
});
jest.mock("next/navigation", () => ({
  ...jest.requireActual("next/navigation"),
  notFound: () => mockNotFound(),
}));

// Heavy child components that use browser APIs or complex imports are stubbed
// so this unit test stays fast and isolated.
jest.mock("../TradeListItemDemo", () => ({
  TradeListItemDemo: () => <div data-testid="trade-list-item-demo" />,
}));
jest.mock("../ErrorBoundaryFixtures", () => ({
  ErrorBoundaryFixtures: () => <div data-testid="error-boundary-fixtures" />,
}));
jest.mock("../OfflineCacheFixtures", () => ({
  OfflineCacheFixtures: () => <div data-testid="offline-cache-fixtures" />,
}));

// Stub UI primitives used in the page to avoid deep dependency chains.
jest.mock("@/components/ui/Icon", () => ({
  Icon: ({ name }: { name: string }) => <span data-testid={`icon-${name}`} />,
}));
jest.mock("@/components/ui/Spinner", () => ({
  Spinner: () => <span data-testid="spinner" />,
}));
jest.mock("@/components/ui/LoadingState", () => ({
  LoadingState: () => <div data-testid="loading-state" />,
}));
jest.mock("@/components/ui/StepIndicator", () => ({
  StepIndicator: () => <div data-testid="step-indicator" />,
}));

// Import the page component AFTER all mocks are set up.
import IconDevPage from "../page";

describe("/dev-test page", () => {
  const originalEnv = process.env.NODE_ENV;

  afterEach(() => {
    // Restore NODE_ENV after each test.
    Object.defineProperty(process.env, "NODE_ENV", {
      value: originalEnv,
      writable: true,
      configurable: true,
    });
    mockNotFound.mockClear();
  });

  describe("in development / test environment", () => {
    it("renders the fixture page without calling notFound()", () => {
      // NODE_ENV is already 'test' in Jest — no override needed.
      render(<IconDevPage />);

      expect(mockNotFound).not.toHaveBeenCalled();
      expect(
        screen.getByRole("heading", { level: 1, name: /Icon Component/i }),
      ).toBeInTheDocument();
    });
  });

  describe("in production environment", () => {
    beforeEach(() => {
      Object.defineProperty(process.env, "NODE_ENV", {
        value: "production",
        writable: true,
        configurable: true,
      });
    });

    it("calls notFound() instead of rendering fixture content", () => {
      // notFound() throws in the real Next.js runtime; our mock records the call.
      try {
        render(<IconDevPage />);
      } catch {
        // Swallow any error thrown by the mock if configured that way.
      }

      expect(mockNotFound).toHaveBeenCalled();
    });

    it("does not render the Icon Component heading in production", () => {
      try {
        render(<IconDevPage />);
      } catch {
        // ignore
      }

      expect(
        screen.queryByRole("heading", { level: 1, name: /Icon Component/i }),
      ).not.toBeInTheDocument();
    });
  });
});
