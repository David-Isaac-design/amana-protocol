import React from "react";
import { render, screen, waitFor, act } from "@testing-library/react";
import SettingsPage from "../page";

// ── Mock useAuth ──────────────────────────────────────────────────────────────

const mockAuthBase = {
  address: "GABCDEFGHIJKLMNOPXYZ",
  token: "test-token",
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

// ── Mock webhooks API ─────────────────────────────────────────────────────────

jest.mock("@/lib/api/webhooks", () => ({
  webhooksApi: {
    list: jest.fn(),
    create: jest.fn(),
    remove: jest.fn(),
  },
  AVAILABLE_EVENTS: [
    "trade.created",
    "trade.completed",
    "trade.disputed",
    "vault.deposited",
    "vault.released",
  ],
}));

// ── Mock UI components not under test ─────────────────────────────────────────

jest.mock("@/components/ui/ConfirmActionModal", () => ({
  ConfirmActionModal: ({ open, onConfirm, children }: any) =>
    open ? (
      <div data-testid="confirm-modal">
        <button onClick={onConfirm}>Confirm</button>
        {children}
      </div>
    ) : null,
}));

jest.mock("@/components/ui/Spinner", () => ({
  Spinner: () => <div data-testid="spinner" />,
}));

jest.mock("@/components/ui/EmptyState", () => ({
  EmptyState: ({
    title,
    description,
  }: {
    title: string;
    description: string;
  }) => (
    <div data-testid="empty-state">
      <p>{title}</p>
      <p>{description}</p>
    </div>
  ),
}));

jest.mock("@/components/ThemeToggle", () => ({
  ThemeToggle: () => <div data-testid="theme-toggle" />,
}));

// ── Imports ───────────────────────────────────────────────────────────────────

import { useAuth } from "@/hooks/useAuth";
import { webhooksApi } from "@/lib/api/webhooks";

const mockedUseAuth = useAuth as jest.MockedFunction<typeof useAuth>;
const mockedList = webhooksApi.list as jest.MockedFunction<
  typeof webhooksApi.list
>;

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Settings – Webhook Management section", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default: list returns empty
    mockedList.mockResolvedValue({ webhooks: [] });
    mockedUseAuth.mockReturnValue(mockAuthBase as any);
  });

  test("renders 'Webhooks' heading", async () => {
    await act(async () => {
      render(<SettingsPage />);
    });

    expect(
      screen.getByRole("heading", { name: /webhooks/i }),
    ).toBeInTheDocument();
  });

  test("calls webhooksApi.list on mount when authenticated", async () => {
    await act(async () => {
      render(<SettingsPage />);
    });

    await waitFor(() => {
      expect(mockedList).toHaveBeenCalledWith("test-token");
    });
  });

  test("shows EmptyState when webhooks list is empty", async () => {
    mockedList.mockResolvedValue({ webhooks: [] });

    await act(async () => {
      render(<SettingsPage />);
    });

    await waitFor(() => {
      expect(screen.getByTestId("empty-state")).toBeInTheDocument();
    });

    expect(screen.getByText("No webhooks")).toBeInTheDocument();
    expect(
      screen.getByText("Register a URL to receive real-time trade events."),
    ).toBeInTheDocument();
  });

  test("shows webhook URL in the list when webhooks exist", async () => {
    mockedList.mockResolvedValue({
      webhooks: [
        {
          id: 1,
          url: "https://example.com/webhook",
          events: ["trade.created"],
          isActive: true,
          createdAt: "2024-01-01T00:00:00.000Z",
        },
      ],
    });

    await act(async () => {
      render(<SettingsPage />);
    });

    await waitFor(() => {
      expect(
        screen.getByText("https://example.com/webhook"),
      ).toBeInTheDocument();
    });
  });
});
