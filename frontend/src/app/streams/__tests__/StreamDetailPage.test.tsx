import { render, screen, waitFor, within } from "@testing-library/react";
import { useParams } from "next/navigation";
import StreamDetailPage from "../[id]/page";
import { useAuth } from "@/hooks/useAuth";
import { useAdmin } from "@/hooks/useAdmin";
import { api } from "@/lib/api";

// Mock dependencies
jest.mock("next/navigation", () => ({
  useParams: jest.fn(),
  useRouter: jest.fn(() => ({
    push: jest.fn(),
    replace: jest.fn(),
    prefetch: jest.fn(),
  })),
}));

jest.mock("@/hooks/useAuth");
jest.mock("@/hooks/useAdmin");
jest.mock("@/lib/api", () => ({
  api: {
    streams: {
      getRemaining: jest.fn(),
    },
  },
  ApiError: class ApiError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "ApiError";
    }
  },
}));

const mockUseParams = useParams as jest.MockedFunction<typeof useParams>;
const mockUseAuth = useAuth as jest.MockedFunction<typeof useAuth>;
const mockUseAdmin = useAdmin as jest.MockedFunction<typeof useAdmin>;

describe("StreamDetailPage", () => {
  const mockStreamId = "stream-123";
  const mockStreamData = {
    assetCode: "USDC",
    decimals: 7,
    totalVested: "1000000",
    claimed: "250000",
    unclaimed: "750000",
    pendingClawback: "0",
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockUseParams.mockReturnValue({ id: mockStreamId });
  });

  describe("Admin Link Visibility with Feature Flag", () => {
    it("shows admin action link when user is admin and feature flag is enabled", async () => {
      mockUseAuth.mockReturnValue({
        token: "mock-token",
        isAuthenticated: true,
        isLoading: false,
        address: "GADMIN123",
        shortAddress: "GADMIN...123",
        isWalletConnected: true,
        isWalletDetected: true,
        error: null,
        connectWallet: jest.fn(),
        authenticate: jest.fn(),
        logout: jest.fn(),
        refreshAuth: jest.fn(),
      });

      mockUseAdmin.mockReturnValue({
        isAdmin: true,
        isAdminUIEnabled: true,
        canAccessAdmin: true,
        adminAddresses: ["GADMIN123"],
      });

      (api.streams.getRemaining as jest.Mock).mockResolvedValue(mockStreamData);

      render(<StreamDetailPage />);

      await waitFor(() => {
        expect(screen.getByText("Manage Stream")).toBeInTheDocument();
      });

      const adminLink = screen.getByText("Manage Stream").closest("a");
      expect(adminLink).toHaveAttribute("href", `/admin/streams/${mockStreamId}`);
    });

    it("does not show admin action link when feature flag is disabled", async () => {
      mockUseAuth.mockReturnValue({
        token: "mock-token",
        isAuthenticated: true,
        isLoading: false,
        address: "GADMIN123",
        shortAddress: "GADMIN...123",
        isWalletConnected: true,
        isWalletDetected: true,
        error: null,
        connectWallet: jest.fn(),
        authenticate: jest.fn(),
        logout: jest.fn(),
        refreshAuth: jest.fn(),
      });

      mockUseAdmin.mockReturnValue({
        isAdmin: true,
        isAdminUIEnabled: false,
        canAccessAdmin: false,
        adminAddresses: ["GADMIN123"],
      });

      (api.streams.getRemaining as jest.Mock).mockResolvedValue(mockStreamData);

      render(<StreamDetailPage />);

      await waitFor(() => {
        expect(screen.getByText("Stream Details")).toBeInTheDocument();
      });

      expect(screen.queryByText("Manage Stream")).not.toBeInTheDocument();
    });

    it("does not show admin action link when user is not admin", async () => {
      mockUseAuth.mockReturnValue({
        token: "mock-token",
        isAuthenticated: true,
        isLoading: false,
        address: "GUSER456",
        shortAddress: "GUSER...456",
        isWalletConnected: true,
        isWalletDetected: true,
        error: null,
        connectWallet: jest.fn(),
        authenticate: jest.fn(),
        logout: jest.fn(),
        refreshAuth: jest.fn(),
      });

      mockUseAdmin.mockReturnValue({
        isAdmin: false,
        isAdminUIEnabled: true,
        canAccessAdmin: false,
        adminAddresses: ["GADMIN123"],
      });

      (api.streams.getRemaining as jest.Mock).mockResolvedValue(mockStreamData);

      render(<StreamDetailPage />);

      await waitFor(() => {
        expect(screen.getByText("Stream Details")).toBeInTheDocument();
      });

      expect(screen.queryByText("Manage Stream")).not.toBeInTheDocument();
    });

    it("does not show admin action link when user is not authenticated", async () => {
      mockUseAuth.mockReturnValue({
        token: null,
        isAuthenticated: false,
        isLoading: false,
        address: null,
        shortAddress: null,
        isWalletConnected: false,
        isWalletDetected: true,
        error: null,
        connectWallet: jest.fn(),
        authenticate: jest.fn(),
        logout: jest.fn(),
        refreshAuth: jest.fn(),
      });

      mockUseAdmin.mockReturnValue({
        isAdmin: false,
        isAdminUIEnabled: true,
        canAccessAdmin: false,
        adminAddresses: ["GADMIN123"],
      });

      render(<StreamDetailPage />);

      await waitFor(() => {
        expect(screen.getByText("Authentication Required")).toBeInTheDocument();
      });

      expect(screen.queryByText("Manage Stream")).not.toBeInTheDocument();
    });
  });

  describe("Stream Data Display", () => {
    beforeEach(() => {
      mockUseAuth.mockReturnValue({
        token: "mock-token",
        isAuthenticated: true,
        isLoading: false,
        address: "GUSER456",
        shortAddress: "GUSER...456",
        isWalletConnected: true,
        isWalletDetected: true,
        error: null,
        connectWallet: jest.fn(),
        authenticate: jest.fn(),
        logout: jest.fn(),
        refreshAuth: jest.fn(),
      });

      mockUseAdmin.mockReturnValue({
        isAdmin: false,
        adminAddresses: ["GADMIN123"],
      });
    });

    it("displays stream data correctly", async () => {
      (api.streams.getRemaining as jest.Mock).mockResolvedValue(mockStreamData);

      render(<StreamDetailPage />);

      expect(await screen.findByText("0.1")).toBeInTheDocument(); // Total Vested
      expect(screen.getByText("0.025")).toBeInTheDocument(); // Claimed
      expect(screen.getByText("0.075")).toBeInTheDocument(); // Unclaimed
    });

    it("shows error state when stream fetch fails", async () => {
      (api.streams.getRemaining as jest.Mock).mockRejectedValue(
        new Error("Stream not found")
      );

      render(<StreamDetailPage />);

      await waitFor(() => {
        expect(screen.getByText("Failed to load stream")).toBeInTheDocument();
      });

      expect(screen.getByText("Stream not found")).toBeInTheDocument();
    });
  });

  describe("Segmented Progress Bar", () => {
    beforeEach(() => {
      mockUseAuth.mockReturnValue({
        token: "mock-token",
        isAuthenticated: true,
        isLoading: false,
        address: "GUSER456",
        shortAddress: "GUSER...456",
        isWalletConnected: true,
        isWalletDetected: true,
        error: null,
        connectWallet: jest.fn(),
        authenticate: jest.fn(),
        logout: jest.fn(),
        refreshAuth: jest.fn(),
      });

      mockUseAdmin.mockReturnValue({
        isAdmin: false,
        adminAddresses: ["GADMIN123"],
      });
    });

    it("segment widths reconcile with API response values", async () => {
      // totalVested=1000000, claimed=250000 (25%), unclaimed=750000 (75%), pendingClawback=0
      (api.streams.getRemaining as jest.Mock).mockResolvedValue(mockStreamData);

      render(<StreamDetailPage />);

      await screen.findByText("0.1"); // wait for data

      const claimedBar = screen.getByTestId("bar-claimed");
      const unclaimedBar = screen.getByTestId("bar-unclaimed");

      expect(claimedBar).toHaveStyle({ width: "25%" });
      expect(unclaimedBar).toHaveStyle({ width: "75%" });
      expect(screen.queryByTestId("bar-locked")).not.toBeInTheDocument();
    });

    it("shows locked segment when pendingClawback is non-zero", async () => {
      // totalVested=1000000, claimed=500000 (50%), unclaimed=300000 (30%), pendingClawback=200000 (20%)
      (api.streams.getRemaining as jest.Mock).mockResolvedValue({
        ...mockStreamData,
        claimed: "500000",
        unclaimed: "300000",
        pendingClawback: "200000",
      });

      render(<StreamDetailPage />);

      await screen.findByText("0.05"); // claimed

      expect(screen.getByTestId("bar-claimed")).toHaveStyle({ width: "50%" });
      expect(screen.getByTestId("bar-unclaimed")).toHaveStyle({ width: "30%" });
      expect(screen.getByTestId("bar-locked")).toHaveStyle({ width: "20%" });
    });

    it("renders accessible aria-label with correct percentages", async () => {
      (api.streams.getRemaining as jest.Mock).mockResolvedValue(mockStreamData);

      render(<StreamDetailPage />);

      await screen.findByText("0.1");

      const bar = screen.getByRole("img", { name: /vesting progress/i });
      expect(bar).toHaveAttribute(
        "aria-label",
        "Vesting progress: 25.00% claimed, 75.00% vested and unclaimed, 0.00% locked pending clawback",
      );
    });

    it("shows legend items matching visible segments", async () => {
      (api.streams.getRemaining as jest.Mock).mockResolvedValue(mockStreamData);

      render(<StreamDetailPage />);

      await screen.findByText("0.1");

      expect(screen.getByText(/vested & unclaimed/i)).toBeInTheDocument();
      // locked legend item hidden when pendingClawback is 0
      expect(screen.queryByText(/locked \/ clawback/i)).not.toBeInTheDocument();
    });
  });

  describe("Breadcrumb Navigation", () => {
    beforeEach(() => {
      mockUseAuth.mockReturnValue({
        token: "mock-token",
        isAuthenticated: true,
        isLoading: false,
        address: "GUSER456",
        shortAddress: "GUSER...456",
        isWalletConnected: true,
        isWalletDetected: true,
        error: null,
        connectWallet: jest.fn(),
        authenticate: jest.fn(),
        logout: jest.fn(),
        refreshAuth: jest.fn(),
      });

      mockUseAdmin.mockReturnValue({
        isAdmin: false,
        adminAddresses: ["GADMIN123"],
      });

      (api.streams.getRemaining as jest.Mock).mockResolvedValue(mockStreamData);
    });

    it("displays breadcrumb navigation with correct hierarchy", async () => {
      render(<StreamDetailPage />);

      await waitFor(() => {
        expect(screen.getByText("Home")).toBeInTheDocument();
      });

      expect(screen.getByText("Streams")).toBeInTheDocument();
      expect(
        within(screen.getByLabelText("Breadcrumb")).getByText(mockStreamId),
      ).toBeInTheDocument();
    });
  });
});
