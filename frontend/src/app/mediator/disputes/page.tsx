"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import { useAuth } from "@/hooks/useAuth";
import { useFreighterIdentity } from "@/hooks/useFreighterIdentity";
import { api, ApiError, DisputeResponse } from "@/lib/api";
import { ErrorState } from "@/components/ui/ErrorState";
import { SkeletonList } from "@/components/ui/SkeletonList";
import { Tabs } from "@/components/ui/Tabs";
import { Button } from "@/components/ui/Button";
import {
  getMediatorAddresses,
  isMediatorAddress,
  formatDate,
  formatAddress,
  formatAge,
  isBreachingSLA,
  SortField,
  SortDirection,
} from "./helpers";

type DisputeStatus = "OPEN" | "UNDER_REVIEW" | "RESOLVED" | "CLOSED";

const FILTERS: { label: string; value: DisputeStatus | "all" }[] = [
  { label: "All Active", value: "all" },
  { label: "Open", value: "OPEN" },
  { label: "Under Review", value: "UNDER_REVIEW" },
  { label: "Resolved", value: "RESOLVED" },
  { label: "Closed", value: "CLOSED" },
];

const STATUS_STYLES: Record<string, string> = {
  OPEN: "text-status-warning bg-status-warning/15",
  UNDER_REVIEW: "text-status-info bg-status-info/15",
  RESOLVED: "text-status-success bg-status-success/15",
  CLOSED: "text-text-secondary bg-bg-elevated",
};

const PAGE_SIZE = 10;

const SORT_OPTIONS: { label: string; field: SortField; dir: SortDirection }[] = [
  { label: "Oldest first", field: "age", dir: "desc" },
  { label: "Newest first", field: "age", dir: "asc" },
  { label: "Largest first", field: "amount", dir: "desc" },
  { label: "Smallest first", field: "amount", dir: "asc" },
];

export default function MediatorDisputesPage() {
  const { token, isAuthenticated } = useAuth();
  const { address } = useFreighterIdentity();
  const [activeFilter, setActiveFilter] = useState<DisputeStatus | "all">("all");
  const [sortField, setSortField] = useState<SortField>("age");
  const [sortDir, setSortDir] = useState<SortDirection>("desc");

  // Cursor-based pagination: stack of cursors; index 0 = first page (no cursor)
  const [cursorStack, setCursorStack] = useState<(number | null)[]>([null]);
  const [currentCursorIndex, setCurrentCursorIndex] = useState(0);

  const [disputes, setDisputes] = useState<DisputeResponse[]>([]);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const mediatorAddresses = useMemo(() => getMediatorAddresses(), []);
  const isMediator = isMediatorAddress(address, mediatorAddresses);

  const currentCursor = cursorStack[currentCursorIndex] ?? null;

  const fetchDisputes = useCallback(async () => {
    if (!isAuthenticated || !token || !isMediator) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const statusParam = activeFilter === "all" ? undefined : activeFilter;
      const response = await api.disputes.list(token, {
        status: statusParam,
        cursor: currentCursor ?? undefined,
        limit: PAGE_SIZE,
        sortBy: sortField,
        sortDir,
      });

      setDisputes(response.items);
      setNextCursor(response.pagination.nextCursor ?? null);
    } catch (err) {
      let errorMessage = "Unable to reach the server. Check your connection and try again.";
      if (err instanceof ApiError) {
        errorMessage = err.message;
      } else if (err instanceof Error) {
        errorMessage = err.message;
      }
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  }, [token, isAuthenticated, isMediator, activeFilter, currentCursor, sortField, sortDir]);

  useEffect(() => {
    fetchDisputes();
  }, [fetchDisputes]);

  function handleFilter(value: DisputeStatus | "all") {
    setActiveFilter(value);
    // Reset pagination to page 1 when filter changes
    setCursorStack([null]);
    setCurrentCursorIndex(0);
  }

  function handleSortChange(field: SortField, dir: SortDirection) {
    setSortField(field);
    setSortDir(dir);
    setCursorStack([null]);
    setCurrentCursorIndex(0);
  }

  function handleNextPage() {
    if (!nextCursor) return;
    const newStack = cursorStack.slice(0, currentCursorIndex + 1);
    newStack.push(nextCursor);
    setCursorStack(newStack);
    setCurrentCursorIndex(newStack.length - 1);
  }

  function handlePrevPage() {
    if (currentCursorIndex === 0) return;
    setCurrentCursorIndex((i) => i - 1);
  }

  const isFirstPage = currentCursorIndex === 0;
  const isLastPage = !nextCursor;

  if (!isMediator) {
    return (
      <div className="px-6 py-8 max-w-6xl mx-auto" data-testid="mediator-disputes-page">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-text-primary mb-4">Access Restricted</h1>
          <p className="text-text-secondary">
            This page is only accessible to authorized mediators.
          </p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="px-6 py-8 max-w-6xl mx-auto" data-testid="mediator-disputes-page">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-3xl font-bold text-text-primary">Mediator Disputes</h1>
        </div>
        <SkeletonList rows={PAGE_SIZE} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="px-6 py-8 max-w-6xl mx-auto" data-testid="mediator-disputes-page">
        <ErrorState
          variant="card"
          title="Couldn't load disputes"
          message={error}
          onRetry={fetchDisputes}
        />
      </div>
    );
  }

  const activeSortLabel =
    SORT_OPTIONS.find((o) => o.field === sortField && o.dir === sortDir)?.label ?? "Sort";

  return (
    <div className="px-6 py-8 max-w-6xl mx-auto" data-testid="mediator-disputes-page">
      {/* Page header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold text-text-primary">Mediator Disputes</h1>

        {/* Sort control */}
        <div className="flex items-center gap-2">
          <label htmlFor="dispute-sort" className="text-sm text-text-secondary sr-only">
            Sort disputes
          </label>
          <select
            id="dispute-sort"
            aria-label="Sort disputes"
            value={`${sortField}:${sortDir}`}
            onChange={(e) => {
              const [field, dir] = e.target.value.split(":") as [SortField, SortDirection];
              handleSortChange(field, dir);
            }}
            className="text-sm bg-bg-elevated border border-border-default rounded-md px-3 py-1.5 text-text-primary focus:outline-none focus:border-gold/50 transition-colors"
          >
            {SORT_OPTIONS.map((o) => (
              <option key={`${o.field}:${o.dir}`} value={`${o.field}:${o.dir}`}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Filters */}
      <Tabs
        items={FILTERS}
        activeValue={activeFilter}
        onChange={handleFilter}
        className="mb-6"
      />

      {/* SLA legend */}
      <div className="flex items-center gap-2 mb-4 text-xs text-text-secondary">
        <span
          className="inline-block w-2.5 h-2.5 rounded-full bg-status-danger/70"
          aria-hidden="true"
        />
        <span>SLA breach — dispute is older than 72 hours</span>
      </div>

      {/* Disputes list */}
      <div className="space-y-4" role="list" aria-label="Disputes">
        {disputes.length === 0 ? (
          <div className="text-center py-12 text-text-secondary">No disputes found</div>
        ) : (
          disputes.map((dispute) => {
            const breaching = isBreachingSLA(dispute.createdAt);
            const ageLabel = formatAge(dispute.createdAt);

            return (
              <Link
                key={dispute.id}
                href={`/mediator/disputes/${dispute.tradeId}`}
                role="listitem"
                className={`block p-6 rounded-lg border transition-colors ${
                  breaching
                    ? "bg-status-danger/5 border-status-danger/40 hover:border-status-danger/60"
                    : "bg-bg-elevated border-border-default hover:border-border-hover"
                }`}
                aria-label={`Dispute for trade ${dispute.tradeId}${breaching ? ", SLA breached" : ""}`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2 flex-wrap">
                      <span className="text-lg font-semibold text-text-primary">
                        Trade {dispute.tradeId}
                      </span>
                      <span
                        className={`px-2 py-1 rounded-full text-xs font-medium ${STATUS_STYLES[dispute.status]}`}
                      >
                        {dispute.status.replace("_", " ")}
                      </span>
                      {breaching && (
                        <span
                          className="px-2 py-1 rounded-full text-xs font-semibold text-status-danger bg-status-danger/15"
                          role="status"
                          aria-label="SLA breached"
                        >
                          SLA breach
                        </span>
                      )}
                    </div>
                    <div className="text-sm text-text-secondary mb-2">
                      Initiated by: {formatAddress(dispute.initiator)}
                    </div>
                    <div className="text-sm text-text-secondary mb-2">
                      Buyer: {formatAddress(dispute.trade.buyerAddress)} | Seller:{" "}
                      {formatAddress(dispute.trade.sellerAddress)}
                    </div>
                    <div className="text-sm text-text-secondary">
                      Amount: ${dispute.trade.amountUsdc} USDC
                    </div>
                    <div className="text-sm text-text-secondary mt-1">
                      Created: {formatDate(dispute.createdAt)}
                    </div>
                  </div>

                  {/* Age pill */}
                  <div
                    className={`ml-4 shrink-0 flex flex-col items-end gap-1`}
                    aria-label={`Age: ${ageLabel}`}
                  >
                    <span
                      className={`text-xs font-semibold tabular-nums px-2 py-1 rounded-full ${
                        breaching
                          ? "text-status-danger bg-status-danger/15"
                          : "text-text-secondary bg-bg-elevated border border-border-default"
                      }`}
                    >
                      {ageLabel}
                    </span>
                  </div>
                </div>
              </Link>
            );
          })
        )}
      </div>

      {/* Cursor pagination */}
      <div className="flex items-center justify-center gap-2 mt-8">
        <Button
          variant="secondary"
          size="sm"
          onClick={handlePrevPage}
          disabled={isFirstPage}
          aria-label="Previous page"
        >
          Previous
        </Button>
        <span className="px-3 py-1 text-sm text-text-secondary">
          Page {currentCursorIndex + 1}
        </span>
        <Button
          variant="secondary"
          size="sm"
          onClick={handleNextPage}
          disabled={isLastPage}
          aria-label="Next page"
        >
          Next
        </Button>
      </div>
    </div>
  );
}
