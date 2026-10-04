"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { api, ApiError, AdminAuditEntry } from "@/lib/api";
import { isForbiddenError } from "@/lib/errorHandler";
import { trackAdminEvent } from "@/lib/analytics";
import { generateBreadcrumbs } from "@/lib/breadcrumbs";
import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { ForbiddenState } from "@/components/ui/ForbiddenState";
import { SkeletonList } from "@/components/ui/SkeletonList";
import { Button } from "@/components/ui/Button";
import { VirtualizedList } from "@/components/ui/VirtualizedList";

const PAGE_SIZE = 20;
const AUDIT_ROW_HEIGHT = 120;

function formatTimestamp(dateString: string): string {
  return new Date(dateString).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatAction(action: string): string {
  return action
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export interface AdminAuditFilters {
  actor: string;
  action: string;
  date: string;
}

export function parseAuditFilters(searchParams: URLSearchParams | null | undefined): AdminAuditFilters {
  return {
    actor: searchParams?.get("actor")?.trim() ?? "",
    action: searchParams?.get("action")?.trim() ?? "",
    date: searchParams?.get("date")?.trim() ?? "",
  };
}

export function serializeAuditFilters(
  currentParams: URLSearchParams | null | undefined,
  filters: AdminAuditFilters,
): URLSearchParams {
  const params = new URLSearchParams(currentParams?.toString() ?? "");

  const nextFilters: Record<string, string> = {
    actor: filters.actor.trim(),
    action: filters.action.trim(),
    date: filters.date.trim(),
  };

  for (const key of Object.keys(nextFilters)) {
    const value = nextFilters[key as keyof AdminAuditFilters];
    if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
  }

  return params;
}

export default function AdminAuditHistoryPage() {
  const { token, isAuthenticated } = useAuth();
  const isAdmin = useIsAdmin();
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const breadcrumbs = generateBreadcrumbs(pathname ?? "/admin/audit");

  const filters = parseAuditFilters(searchParams);

  const [entries, setEntries] = useState<AdminAuditEntry[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);

  const fetchAuditHistory = useCallback(async () => {
    if (!isAuthenticated || !token || !isAdmin) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    setForbidden(false);

    try {
      const response = await api.adminAudit.list(token, { page, limit: PAGE_SIZE });
      setEntries(response.items);
      setTotalPages(response.pagination.totalPages);
      trackAdminEvent("admin_audit_page_view", "success", { page });
    } catch (err) {
      if (err instanceof ApiError && isForbiddenError(err)) {
        setForbidden(true);
        trackAdminEvent("admin_audit_page_view", "failed", { reason: "forbidden" });
      } else {
        const errorMessage =
          err instanceof Error ? err.message : "Unable to reach the server. Check your connection and try again.";
        setError(errorMessage);
        trackAdminEvent("admin_audit_page_view", "failed", { reason: "error" });
      }
    } finally {
      setLoading(false);
    }
  }, [token, isAuthenticated, isAdmin, page]);

  useEffect(() => {
    trackAdminEvent("admin_audit_page_view", "viewed");
  }, []);

  useEffect(() => {
    fetchAuditHistory();
  }, [fetchAuditHistory]);

  const actionOptions = useMemo(
    () => Array.from(new Set(entries.map((entry) => entry.action))).sort(),
    [entries],
  );

  const filteredEntries = useMemo(() => {
    const actorQuery = filters.actor.toLowerCase();
    const actionQuery = filters.action.toLowerCase();
    const dateQuery = filters.date;

    return entries.filter((entry) => {
      const matchesActor =
        !actorQuery || entry.actorAddress.toLowerCase().includes(actorQuery);
      const matchesAction =
        !actionQuery || entry.action.toLowerCase() === actionQuery || formatAction(entry.action).toLowerCase() === actionQuery;
      const entryDate = new Date(entry.createdAt).toISOString().slice(0, 10);
      const matchesDate = !dateQuery || entryDate === dateQuery;

      return matchesActor && matchesAction && matchesDate;
    });
  }, [entries, filters]);

  const hasActiveFilters = Boolean(filters.actor || filters.action || filters.date);

  const updateFilters = useCallback(
    (nextFilters: AdminAuditFilters) => {
      const params = serializeAuditFilters(searchParams, nextFilters);
      const nextUrl = params.toString() ? `${pathname}?${params.toString()}` : pathname ?? "/admin/audit";
      router.replace(nextUrl, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  if (!isAdmin) {
    return (
      <div className="px-6 py-8 max-w-6xl mx-auto" data-testid="admin-audit-page">
        <ForbiddenState />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="px-6 py-8 max-w-6xl mx-auto" data-testid="admin-audit-page">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-3xl font-bold text-text-primary">Admin Action History</h1>
        </div>
        <SkeletonList rows={PAGE_SIZE} />
      </div>
    );
  }

  if (forbidden) {
    return (
      <div className="px-6 py-8 max-w-6xl mx-auto" data-testid="admin-audit-page">
        <ForbiddenState />
      </div>
    );
  }

  if (error) {
    return (
      <div className="px-6 py-8 max-w-6xl mx-auto" data-testid="admin-audit-page">
        <ErrorState
          variant="card"
          title="Couldn't load admin action history"
          message={error}
          onRetry={fetchAuditHistory}
        />
      </div>
    );
  }

  return (
    <div className="px-6 py-8 max-w-6xl mx-auto" data-testid="admin-audit-page">
      <Breadcrumbs items={breadcrumbs} className="mb-3" />
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold text-text-primary">Admin Action History</h1>
      </div>

      <div className="mb-6 grid gap-3 rounded-lg border border-border-default bg-bg-elevated p-4 md:grid-cols-[1.5fr_1.2fr_1fr_auto]">
        <label className="flex flex-col gap-1 text-sm text-text-secondary">
          <span>Actor</span>
          <input
            aria-label="Filter by actor"
            type="text"
            value={filters.actor}
            onChange={(event) => updateFilters({ ...filters, actor: event.target.value })}
            placeholder="Search actor"
            className="rounded-md border border-border-default bg-bg-base px-3 py-2 text-sm text-text-primary outline-none focus:border-border-hover"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm text-text-secondary">
          <span>Action type</span>
          <select
            aria-label="Filter by action type"
            value={filters.action}
            onChange={(event) => updateFilters({ ...filters, action: event.target.value })}
            className="rounded-md border border-border-default bg-bg-base px-3 py-2 text-sm text-text-primary outline-none focus:border-border-hover"
          >
            <option value="">All actions</option>
            {actionOptions.map((action) => (
              <option key={action} value={action}>
                {formatAction(action)}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm text-text-secondary">
          <span>Date</span>
          <input
            aria-label="Filter by date"
            type="date"
            value={filters.date}
            onChange={(event) => updateFilters({ ...filters, date: event.target.value })}
            className="rounded-md border border-border-default bg-bg-base px-3 py-2 text-sm text-text-primary outline-none focus:border-border-hover"
          />
        </label>

        <div className="flex items-end">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => updateFilters({ actor: "", action: "", date: "" })}
            className="w-full md:w-auto"
            disabled={!hasActiveFilters}
          >
            Clear filters
          </Button>
        </div>
      </div>

      <VirtualizedList
        items={filteredEntries}
        rowHeight={AUDIT_ROW_HEIGHT}
        maxHeight={Math.min(filteredEntries.length * AUDIT_ROW_HEIGHT, 600)}
        keyExtractor={(entry) => String(entry.id)}
        isEmpty={filteredEntries.length === 0}
        emptyState={
          hasActiveFilters ? (
            <EmptyState
              title="No matching admin actions"
              description="Try clearing one or more filters to view more audit entries."
            />
          ) : (
            <div className="text-center py-12 text-text-secondary">No admin actions recorded yet</div>
          )
        }
        renderItem={(entry) => (
          <div className="p-6 bg-bg-elevated rounded-lg border border-border-default mb-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-lg font-semibold text-text-primary">
                    {formatAction(entry.action)}
                  </span>
                </div>
                <div className="text-sm text-text-secondary mb-1">
                  Admin: {entry.actorAddress}
                </div>
                {entry.targetReference && (
                  <div className="text-sm text-text-secondary mb-1">
                    Reference: {entry.targetReference}
                  </div>
                )}
                {entry.note && (
                  <div className="text-sm text-text-secondary mb-1">Note: {entry.note}</div>
                )}
              </div>
              <div className="text-sm text-text-secondary whitespace-nowrap">
                {formatTimestamp(entry.createdAt)}
              </div>
            </div>
          </div>
        )}
      />

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-8">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
          >
            Previous
          </Button>
          <span className="px-3 py-1 text-sm text-text-secondary">
            Page {page} of {totalPages}
          </span>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
