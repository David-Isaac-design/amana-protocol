import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MediatorDisputesPage from "../page";
import { useAuth } from "@/hooks/useAuth";
import { useFreighterIdentity } from "@/hooks/useFreighterIdentity";
import { api, ApiError } from "@/lib/api";

jest.mock("@/hooks/useAuth");
jest.mock("@/hooks/useFreighterIdentity");
jest.mock("@/lib/api", () => ({
  api: {
    disputes: {
      list: jest.fn(),
    },
  },
  ApiError: class ApiError extends Error {
    status: number;
    data: unknown;
    constructor(status: number, message: string, data?: unknown) {
      super(message);
      this.name = "ApiError";
      this.status = status;
      this.data = data;
    }
  },
}));

const mockUseAuth = useAuth as jest.MockedFunction<typeof useAuth>;
const mockUseFreighterIdentity = useFreighterIdentity as jest.MockedFunction<
  typeof useFreighterIdentity
>;
const mockList = api.disputes.list as jest.MockedFunction<typeof api.disputes.list>;

const MEDIATOR_ADDRESS = "GEXAMPLEMEDIATORPUBLICKEY1";

function makeDispute(overrides = {}) {
  return {
    id: 1,
    tradeId: "trade-1",
    status: "OPEN",
    reason: "damaged goods",
    initiator: "GBUYER1234567890",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    trade: {
      buyerAddress: "GBUYER1234567890",
      sellerAddress: "GSELLER1234567890",
      amountUsdc: "100",
    },
    ...overrides,
  };
}

function makePagination(overrides = {}) {
  return {
    page: 1,
    limit: 10,
    total: 1,
    totalPages: 1,
    nextCursor: null,
    prevCursor: null,
    ...overrides,
  };
}

describe("MediatorDisputesPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseAuth.mockReturnValue({
      token: "test-token",
      isAuthenticated: true,
    } as ReturnType<typeof useAuth>);
    mockUseFreighterIdentity.mockReturnValue({
      address: MEDIATOR_ADDRESS,
    } as ReturnType<typeof useFreighterIdentity>);
  });

  it("shows a skeleton while loading", async () => {
    mockList.mockReturnValue(new Promise(() => {}));

    const { container } = render(<MediatorDisputesPage />);

    expect(container.querySelector('[aria-busy="true"]')).toBeInTheDocument();
  });

  it("shows a retryable error state with actionable messaging when the fetch fails", async () => {
    mockList.mockRejectedValueOnce(new ApiError(500, "Failed to reach disputes service"));

    render(<MediatorDisputesPage />);

    await waitFor(() => {
      expect(screen.getByText("Couldn't load disputes")).toBeInTheDocument();
    });
    expect(screen.getByText("Failed to reach disputes service")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });

  it("refetches disputes when the retry button is clicked", async () => {
    mockList
      .mockRejectedValueOnce(new ApiError(500, "Failed to reach disputes service"))
      .mockResolvedValueOnce({
        items: [makeDispute()],
        pagination: makePagination(),
      });

    render(<MediatorDisputesPage />);

    await waitFor(() => {
      expect(screen.getByText("Couldn't load disputes")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole("button", { name: /try again/i }));

    await waitFor(() => {
      expect(screen.getByText(/Trade trade-1/)).toBeInTheDocument();
    });
    expect(mockList).toHaveBeenCalledTimes(2);
  });

  it("renders status filters as the shared Tabs component", async () => {
    mockList.mockResolvedValue({ items: [], pagination: makePagination() });

    render(<MediatorDisputesPage />);

    await waitFor(() => {
      expect(screen.getByRole("tablist")).toBeInTheDocument();
    });
    expect(screen.getByRole("tab", { name: "Open" })).toBeInTheDocument();
  });

  it("renders a sort select with the expected options", async () => {
    mockList.mockResolvedValue({ items: [], pagination: makePagination() });

    render(<MediatorDisputesPage />);

    await waitFor(() => {
      expect(screen.getByLabelText("Sort disputes")).toBeInTheDocument();
    });
    expect(screen.getByRole("option", { name: "Oldest first" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Newest first" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Largest first" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Smallest first" })).toBeInTheDocument();
  });

  it("resets to page 1 and refetches when sort changes", async () => {
    mockList.mockResolvedValue({ items: [], pagination: makePagination() });

    render(<MediatorDisputesPage />);

    await waitFor(() => expect(screen.getByLabelText("Sort disputes")).toBeInTheDocument());

    await userEvent.selectOptions(screen.getByLabelText("Sort disputes"), "age:asc");

    await waitFor(() => {
      expect(mockList).toHaveBeenCalledWith(
        "test-token",
        expect.objectContaining({ sortBy: "age", sortDir: "asc" }),
      );
    });
  });

  it("highlights SLA-breaching disputes with a badge", async () => {
    // Dispute older than 72 hours
    const oldDispute = makeDispute({
      id: 2,
      tradeId: "trade-old",
      createdAt: new Date(Date.now() - 80 * 60 * 60 * 1000).toISOString(),
    });

    mockList.mockResolvedValue({
      items: [oldDispute],
      pagination: makePagination(),
    });

    render(<MediatorDisputesPage />);

    await waitFor(() => {
      expect(screen.getByRole("status", { name: "SLA breached" })).toBeInTheDocument();
    });
  });

  it("does not show SLA badge for disputes within SLA", async () => {
    const freshDispute = makeDispute({
      id: 3,
      tradeId: "trade-fresh",
      createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    });

    mockList.mockResolvedValue({
      items: [freshDispute],
      pagination: makePagination(),
    });

    render(<MediatorDisputesPage />);

    await waitFor(() => {
      expect(screen.getByText(/Trade trade-fresh/)).toBeInTheDocument();
    });
    expect(screen.queryByRole("status", { name: "SLA breached" })).not.toBeInTheDocument();
  });

  it("advances to the next page when Next is clicked and a cursor is available", async () => {
    mockList
      .mockResolvedValueOnce({
        items: [makeDispute({ id: 1, tradeId: "trade-p1" })],
        pagination: makePagination({ nextCursor: 42 }),
      })
      .mockResolvedValueOnce({
        items: [makeDispute({ id: 2, tradeId: "trade-p2" })],
        pagination: makePagination({ prevCursor: 1 }),
      });

    render(<MediatorDisputesPage />);

    await waitFor(() => expect(screen.getByText(/Trade trade-p1/)).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: /next page/i }));

    await waitFor(() => expect(screen.getByText(/Trade trade-p2/)).toBeInTheDocument());
    expect(mockList).toHaveBeenLastCalledWith(
      "test-token",
      expect.objectContaining({ cursor: 42 }),
    );
  });

  it("goes back to the previous page when Previous is clicked", async () => {
    mockList
      .mockResolvedValueOnce({
        items: [makeDispute({ id: 1, tradeId: "trade-p1" })],
        pagination: makePagination({ nextCursor: 42 }),
      })
      .mockResolvedValueOnce({
        items: [makeDispute({ id: 2, tradeId: "trade-p2" })],
        pagination: makePagination({ prevCursor: 1 }),
      })
      .mockResolvedValueOnce({
        items: [makeDispute({ id: 1, tradeId: "trade-p1" })],
        pagination: makePagination({ nextCursor: 42 }),
      });

    render(<MediatorDisputesPage />);

    await waitFor(() => expect(screen.getByText(/Trade trade-p1/)).toBeInTheDocument());

    // Go to page 2
    await userEvent.click(screen.getByRole("button", { name: /next page/i }));
    await waitFor(() => expect(screen.getByText(/Trade trade-p2/)).toBeInTheDocument());

    // Go back to page 1
    await userEvent.click(screen.getByRole("button", { name: /previous page/i }));
    await waitFor(() => expect(screen.getByText(/Trade trade-p1/)).toBeInTheDocument());
  });

  it("disables the Previous button on the first page", async () => {
    mockList.mockResolvedValue({ items: [], pagination: makePagination() });

    render(<MediatorDisputesPage />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /previous page/i })).toBeDisabled();
    });
  });

  it("disables the Next button when there is no next cursor", async () => {
    mockList.mockResolvedValue({
      items: [makeDispute()],
      pagination: makePagination({ nextCursor: null }),
    });

    render(<MediatorDisputesPage />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /next page/i })).toBeDisabled();
    });
  });
});
