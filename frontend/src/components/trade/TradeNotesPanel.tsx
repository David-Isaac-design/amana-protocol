"use client";

/**
 * TradeNotesPanel — shows the thread of notes attached to a trade.
 *
 * Features:
 *  - Lists notes newest-first with author wallet address and formatted time
 *  - Composer with a 500-character limit
 *  - Optimistic add with automatic rollback on API error
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import type { TradeNote } from "@/types/trade";

const MAX_CHARS = 500;

function formatNoteDate(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatAuthor(address: string, name?: string): string {
  if (name) return name;
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

interface TradeNotesPanelProps {
  tradeId: string;
  token: string | null;
}

export function TradeNotesPanel({ tradeId, token }: TradeNotesPanelProps) {
  const [notes, setNotes] = useState<TradeNote[]>([]);
  const [loadState, setLoadState] = useState<"idle" | "loading" | "error">("loading");
  const [loadError, setLoadError] = useState<string | null>(null);

  const [body, setBody] = useState("");
  const [submitState, setSubmitState] = useState<"idle" | "submitting" | "error">("idle");
  const [submitError, setSubmitError] = useState<string | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // ── Load notes ─────────────────────────────────────────────────────────────

  const fetchNotes = useCallback(async () => {
    if (!token) {
      setLoadState("idle");
      return;
    }

    setLoadState("loading");
    setLoadError(null);

    try {
      const result = await api.trades.getNotes(token, tradeId);
      // Sort newest-first.
      const sorted = [...result.notes].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
      setNotes(sorted);
      setLoadState("idle");
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Failed to load notes";
      setLoadError(message);
      setLoadState("error");
    }
  }, [token, tradeId]);

  useEffect(() => {
    void fetchNotes();
  }, [fetchNotes]);

  // ── Submit note (optimistic) ────────────────────────────────────────────────

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const trimmed = body.trim();
    if (!trimmed || !token) return;

    // Build an optimistic placeholder note.
    const optimisticId = `optimistic-${Date.now()}`;
    const optimisticNote: TradeNote = {
      id: optimisticId,
      tradeId,
      authorAddress: "You",
      body: trimmed,
      createdAt: new Date().toISOString(),
    };

    // Show it immediately at the top of the list.
    setNotes((prev) => [optimisticNote, ...prev]);
    setBody("");
    setSubmitState("submitting");
    setSubmitError(null);

    try {
      const result = await api.trades.addNote(token, tradeId, { body: trimmed });

      // Replace the optimistic entry with the confirmed note from the server.
      const confirmed: TradeNote = {
        id: result.note.id,
        tradeId: result.note.tradeId,
        authorAddress: result.note.authorAddress,
        authorName: result.note.authorName,
        body: result.note.body,
        createdAt: result.note.createdAt,
      };
      setNotes((prev) =>
        prev.map((n) => (n.id === optimisticId ? confirmed : n)),
      );
      setSubmitState("idle");
    } catch (err) {
      // Rollback: remove the optimistic entry.
      setNotes((prev) => prev.filter((n) => n.id !== optimisticId));
      setBody(trimmed); // restore what the user typed

      const message =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Failed to post note";
      setSubmitError(message);
      setSubmitState("error");

      // Re-focus the textarea so the user can try again.
      textareaRef.current?.focus();
    }
  }

  const remaining = MAX_CHARS - body.length;
  const overLimit = remaining < 0;

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <section
      aria-labelledby="trade-notes-heading"
      className="rounded-lg border border-border-default bg-bg-card p-5"
    >
      <h2
        id="trade-notes-heading"
        className="text-xs uppercase tracking-wide text-text-muted mb-4"
      >
        Trade Notes
      </h2>

      {/* ── Composer ────────────────────────────────────────────────────── */}
      {token && (
        <form onSubmit={(e) => void handleSubmit(e)} className="mb-5" noValidate>
          <label htmlFor="trade-note-body" className="sr-only">
            Add a note (max {MAX_CHARS} characters)
          </label>
          <textarea
            id="trade-note-body"
            ref={textareaRef}
            value={body}
            onChange={(e) => {
              setBody(e.target.value);
              setSubmitError(null);
            }}
            rows={3}
            maxLength={MAX_CHARS + 1} // allow one over so the counter turns red
            placeholder="Add a note…"
            aria-describedby="trade-note-char-count"
            disabled={submitState === "submitting"}
            className="w-full rounded-md border border-border-default bg-bg-elevated px-3 py-2 text-sm text-text-primary placeholder:text-text-muted resize-none focus:outline-none focus:ring-2 focus:ring-gold disabled:opacity-50 disabled:cursor-not-allowed"
          />

          <div className="mt-1.5 flex items-center justify-between gap-2">
            <p
              id="trade-note-char-count"
              aria-live="polite"
              className={`text-xs ${overLimit ? "text-status-danger" : "text-text-muted"}`}
            >
              {remaining < 0 ? `${Math.abs(remaining)} over limit` : `${remaining} remaining`}
            </p>

            <button
              type="submit"
              disabled={!body.trim() || overLimit || submitState === "submitting"}
              className="rounded-lg bg-gold px-3 py-1.5 text-xs font-semibold text-text-inverse transition-colors hover:bg-gold-hover disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitState === "submitting" ? "Posting…" : "Post"}
            </button>
          </div>

          {submitError && (
            <p role="alert" className="mt-2 text-xs text-status-danger">
              {submitError}
            </p>
          )}
        </form>
      )}

      {/* ── Notes list ──────────────────────────────────────────────────── */}
      {loadState === "loading" && (
        <div
          aria-busy="true"
          aria-label="Loading notes"
          className="flex flex-col gap-3"
          data-testid="notes-loading"
        >
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-14 animate-pulse rounded-md bg-bg-elevated"
            />
          ))}
        </div>
      )}

      {loadState === "error" && (
        <div
          role="alert"
          className="rounded-md border border-status-danger/20 bg-red-500/10 px-4 py-3 text-center"
          data-testid="notes-error"
        >
          <p className="text-sm text-status-danger">{loadError}</p>
          <button
            onClick={() => void fetchNotes()}
            className="mt-2 text-xs underline text-text-secondary hover:text-text-primary"
          >
            Retry
          </button>
        </div>
      )}

      {loadState === "idle" && notes.length === 0 && (
        <p
          className="text-sm text-text-muted text-center py-6"
          data-testid="notes-empty"
        >
          No notes yet. Be the first to add one.
        </p>
      )}

      {loadState === "idle" && notes.length > 0 && (
        <ol
          aria-label="Trade notes list"
          className="flex flex-col gap-3"
          data-testid="notes-list"
        >
          {notes.map((note) => (
            <li
              key={note.id}
              className="rounded-md border border-border-default bg-bg-elevated px-4 py-3"
              data-testid={`note-item-${note.id}`}
            >
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="text-xs font-medium text-text-secondary font-mono">
                  {formatAuthor(note.authorAddress, note.authorName)}
                </span>
                <time
                  dateTime={note.createdAt}
                  className="text-xs text-text-muted whitespace-nowrap"
                >
                  {formatNoteDate(note.createdAt)}
                </time>
              </div>
              <p className="text-sm text-text-primary whitespace-pre-wrap break-words">
                {note.body}
              </p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
