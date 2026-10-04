import React from "react";
import { render, screen } from "@testing-library/react";
import SettingsPage from "../page";

// ── Mock useAuth ──────────────────────────────────────────────────────────────

const mockAuthBase = {
  isAuthenticated: true,
  isWalletConnected: true,
  isWalletDetected: true,
  isLoading: false,
  connectWallet: jest.fn(),
  authenticate: jest.fn(),
  logout: jest.fn(),
};

jest.mock("@/hooks/useAuth", () => ({
  useAuth: jest.fn(),
}));

// ── Mock ConfirmActionModal ───────────────────────────────────────────────────

jest.mock("@/components/ui/ConfirmActionModal", () => ({
  ConfirmActionModal: ({ open, onConfirm, children }: any) =>
    open ? (
      <div data-testid="confirm-modal">
        <button onClick={onConfirm}>Confirm</button>
        {children}
      </div>
    ) : null,
}));

// ── Mock ThemeToggle (not under test) ─────────────────────────────────────────

jest.mock("@/components/ThemeToggle", () => ({
  ThemeToggle: () => <div data-testid="theme-toggle" />,
}));

// ── Mock EmptyState so we can assert on it easily ─────────────────────────────

jest.mock("@/components/ui/EmptyState", () => ({
  EmptyState: ({ title, description }: { title: string; description: string }) => (
    <div data-testid="empty-state">
      <p>{title}</p>
      <p>{description}</p>
    </div>
  ),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

import { useAuth } from "@/hooks/useAuth";

const mockedUseAuth = useAuth as jest.MockedFunction<typeof useAuth>;

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Settings – Linked Wallets section", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("renders the Linked Wallets section heading", () => {
    mockedUseAuth.mockReturnValue({
      ...mockAuthBase,
      address: "GABCDEFGHIJKLMNOPXYZ",
    } as any);

    render(<SettingsPage />);

    expect(
      screen.getByRole("heading", { name: /linked wallets/i }),
    ).toBeInTheDocument();
  });

  test("shows the primary wallet address when authenticated", () => {
    const testAddress = "GABCDEFG12345XYZ";
    mockedUseAuth.mockReturnValue({
      ...mockAuthBase,
      address: testAddress,
    } as any);

    render(<SettingsPage />);

    // The address is truncated: first 8 + ... + last 6
    const truncated = `${testAddress.slice(0, 8)}...${testAddress.slice(-6)}`;
    expect(screen.getByText(truncated)).toBeInTheDocument();

    // Should show the Primary badge
    expect(screen.getByText("Primary")).toBeInTheDocument();
  });

  test("shows EmptyState when address is null", () => {
    mockedUseAuth.mockReturnValue({
      ...mockAuthBase,
      address: null,
      isAuthenticated: false,
      isWalletConnected: false,
    } as any);

    render(<SettingsPage />);

    // The linked-wallets EmptyState has unique text — assert by text content
    expect(screen.getByText("No wallets linked")).toBeInTheDocument();
    expect(
      screen.getByText("Connect a Freighter wallet to get started."),
    ).toBeInTheDocument();
  });
});
