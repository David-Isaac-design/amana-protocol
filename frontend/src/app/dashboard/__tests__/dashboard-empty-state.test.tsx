import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import DashboardPage from "../page";
import { useAuth } from "@/hooks/useAuth";
import { api } from "@/lib/api";

jest.mock("next/link", () => ({
  __esModule: true,
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

jest.mock("@/hooks/useAuth", () => ({
  useAuth: jest.fn(),
}));

jest.mock("@/lib/api", () => ({
  api: {
    trades: {
      getStats: jest.fn(),
      list: jest.fn(),
    },
  },
  ApiError: class ApiError extends Error {},
}));

const mockUseAuth = useAuth as unknown as jest.Mock;

const zeroStats = { totalTrades: 0, totalVolume: 0, openTrades: 0 };
const emptyList = {
  items: [],
  pagination: { page: 1, limit: 5, total: 0, totalPages: 0 },
};

const activeTrade = {
  tradeId: "trade-abcdef123456",
  buyerAddress: "GBUYERADDRESS000000000000000000000000000000000000000000",
  sellerAddress: "GSELLERADDRESS00000000000000000000000000000000000000000",
  amountCngn: "5000",
  buyerLossBps: 0,
  sellerLossBps: 0,
  status: "active",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

beforeEach(() => {
  jest.clearAllMocks();
  mockUseAuth.mockReturnValue({
    token: "jwt-token",
    isAuthenticated: true,
    connectWallet: jest.fn(),
  });
});

describe("Dashboard first-time (zero-trade) empty state", () => {
  it("shows the onboarding empty state with both CTAs when there are no trades", async () => {
    (api.trades.getStats as jest.Mock).mockResolvedValue(zeroStats);
    (api.trades.list as jest.Mock).mockResolvedValue(emptyList);

    render(<DashboardPage />);

    const emptyState = await screen.findByTestId(
      "dashboard-onboarding-empty-state",
    );
    expect(emptyState).toBeInTheDocument();

    expect(screen.getByText("No trades yet")).toBeInTheDocument();

    const createTradeCta = screen.getByRole("link", {
      name: /create your first trade/i,
    });
    expect(createTradeCta).toHaveAttribute("href", "/trades/create");

    expect(
      screen.getByRole("button", { name: /connect wallet/i }),
    ).toBeInTheDocument();

    // The zeroed stat cards are replaced by guidance, not shown alongside it.
    expect(screen.queryByText("Total Volume")).not.toBeInTheDocument();
  });

  it("calls connectWallet when the Connect wallet CTA is clicked", async () => {
    const connectWallet = jest.fn();
    mockUseAuth.mockReturnValue({
      token: "jwt-token",
      isAuthenticated: true,
      connectWallet,
    });
    (api.trades.getStats as jest.Mock).mockResolvedValue(zeroStats);
    (api.trades.list as jest.Mock).mockResolvedValue(emptyList);

    render(<DashboardPage />);

    const cta = await screen.findByRole("button", { name: /connect wallet/i });
    cta.click();

    expect(connectWallet).toHaveBeenCalledTimes(1);
  });

  it("renders the stats grid instead of the empty state once trades exist", async () => {
    (api.trades.getStats as jest.Mock).mockResolvedValue({
      totalTrades: 3,
      totalVolume: 12000,
      openTrades: 1,
    });
    (api.trades.list as jest.Mock).mockResolvedValue({
      items: [activeTrade],
      pagination: { page: 1, limit: 5, total: 1, totalPages: 1 },
    });

    render(<DashboardPage />);

    await waitFor(() =>
      expect(screen.getByText("Total Volume")).toBeInTheDocument(),
    );
    expect(
      screen.queryByTestId("dashboard-onboarding-empty-state"),
    ).not.toBeInTheDocument();
  });
});
