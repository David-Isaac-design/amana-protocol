import { render, screen, waitFor } from "@testing-library/react";
import AdminAuditHistoryPage, {
  parseAuditFilters,
  serializeAuditFilters,
} from "../page";
import { useAuth } from "@/hooks/useAuth";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { api, ApiError } from "@/lib/api";
import { trackAdminEvent } from "@/lib/analytics";

const mockReplace = jest.fn();

jest.mock("next/navigation", () => ({
  usePathname: () => "/admin/audit",
  useRouter: () => ({ replace: mockReplace }),
  useSearchParams: () => new URLSearchParams(),
}));

jest.mock("@/hooks/useAuth");
jest.mock("@/hooks/useIsAdmin");
jest.mock("@/lib/analytics", () => ({
  trackAdminEvent: jest.fn(),
}));
jest.mock("@/lib/api", () => {
  const { ApiError: RealApiError } = jest.requireActual("@/lib/api/client");
  return {
    api: {
      adminAudit: {
        list: jest.fn(),
      },
    },
    ApiError: RealApiError,
  };
});

const mockUseAuth = useAuth as jest.MockedFunction<typeof useAuth>;
const mockUseIsAdmin = useIsAdmin as jest.MockedFunction<typeof useIsAdmin>;
const mockList = api.adminAudit.list as jest.MockedFunction<typeof api.adminAudit.list>;
const mockTrackAdminEvent = trackAdminEvent as jest.MockedFunction<typeof trackAdminEvent>;

function makeEntry(overrides = {}) {
  return {
    id: 1,
    action: "TREASURY_WITHDRAW",
    actorAddress: "GADMIN1234567890",
    targetReference: "GDEST1234567890",
    note: "Reclaiming funds per OPS-42",
    createdAt: "2026-07-05T12:00:00.000Z",
    ...overrides,
  };
}

describe("parseAuditFilters / serializeAuditFilters", () => {
  it("serializes only populated filters and drops empty values deterministically", () => {
    const params = serializeAuditFilters(new URLSearchParams("page=3&tab=overview"), {
      actor: "  alice  ",
      action: "",
      date: "2026-07-05",
    });

    expect(params.get("page")).toBe("3");
    expect(params.get("tab")).toBe("overview");
    expect(params.get("actor")).toBe("alice");
    expect(params.get("date")).toBe("2026-07-05");
    expect(params.has("action")).toBe(false);
  });

  it("clears removed filter values without deleting unrelated query params", () => {
    const params = serializeAuditFilters(new URLSearchParams("page=2&tab=overview&actor=old"), {
      actor: "",
      action: "TREASURY_WITHDRAW",
      date: "",
    });

    expect(params.get("page")).toBe("2");
    expect(params.get("tab")).toBe("overview");
    expect(params.get("actor")).toBeNull();
    expect(params.get("action")).toBe("TREASURY_WITHDRAW");
    expect(params.has("date")).toBe(false);
  });

  it("parses empty and populated query params into a canonical filter state", () => {
    expect(parseAuditFilters(new URLSearchParams("actor= Alice &action=TREASURY_WITHDRAW&date=2026-07-05"))).toEqual({
      actor: "Alice",
      action: "TREASURY_WITHDRAW",
      date: "2026-07-05",
    });

    expect(parseAuditFilters(new URLSearchParams("page=2"))).toEqual({
      actor: "",
      action: "",
      date: "",
    });
  });
});

describe("AdminAuditHistoryPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockReplace.mockClear();
    mockUseAuth.mockReturnValue({
      token: "test-token",
      isAuthenticated: true,
    } as ReturnType<typeof useAuth>);
    mockUseIsAdmin.mockReturnValue(true);
  });

  it("shows a ForbiddenState instead of fetching when the wallet is not an admin", () => {
    mockUseIsAdmin.mockReturnValue(false);

    render(<AdminAuditHistoryPage />);

    expect(screen.getByTestId("forbidden-state")).toBeInTheDocument();
    expect(mockList).not.toHaveBeenCalled();
  });

  it("shows a skeleton while loading", () => {
    mockList.mockReturnValue(new Promise(() => {}));

    const { container } = render(<AdminAuditHistoryPage />);

    expect(container.querySelector('[aria-busy="true"]')).toBeInTheDocument();
  });

  it("emits a page-view analytics event on mount", () => {
    mockList.mockReturnValue(new Promise(() => {}));

    render(<AdminAuditHistoryPage />);

    expect(mockTrackAdminEvent).toHaveBeenCalledWith("admin_audit_page_view", "viewed");
  });

  it("renders audit entries once loaded", async () => {
    mockList.mockResolvedValueOnce({
      items: [makeEntry()],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });

    render(<AdminAuditHistoryPage />);

    await waitFor(() => {
      expect(screen.getAllByText("Treasury Withdraw").length).toBeGreaterThan(0);
    });
    expect(screen.getByText(/GADMIN1234567890/)).toBeInTheDocument();
    expect(mockTrackAdminEvent).toHaveBeenCalledWith("admin_audit_page_view", "success", { page: 1 });
  });

  it("shows a ForbiddenState when the backend returns a 403", async () => {
    mockList.mockRejectedValueOnce(new ApiError(403, "Forbidden: admin access required"));

    render(<AdminAuditHistoryPage />);

    await waitFor(() => {
      expect(screen.getByTestId("forbidden-state")).toBeInTheDocument();
    });
    expect(mockTrackAdminEvent).toHaveBeenCalledWith("admin_audit_page_view", "failed", {
      reason: "forbidden",
    });
  });

  it("shows a retryable error state for non-403 failures", async () => {
    mockList.mockRejectedValueOnce(new ApiError(500, "Failed to reach admin audit service"));

    render(<AdminAuditHistoryPage />);

    await waitFor(() => {
      expect(screen.getByText("Couldn't load admin action history")).toBeInTheDocument();
    });
    expect(screen.getByText("Failed to reach admin audit service")).toBeInTheDocument();
  });

  it("shows an empty state when there are no audit entries", async () => {
    mockList.mockResolvedValueOnce({
      items: [],
      pagination: { page: 1, limit: 20, total: 0, totalPages: 1 },
    });

    render(<AdminAuditHistoryPage />);

    await waitFor(() => {
      expect(screen.getByText("No admin actions recorded yet")).toBeInTheDocument();
    });
  });
});
