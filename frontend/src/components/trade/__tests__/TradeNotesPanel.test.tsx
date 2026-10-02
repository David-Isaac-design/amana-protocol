/**
 * Tests for TradeNotesPanel (#56).
 *
 * Covers:
 *  - Empty state when no notes exist
 *  - Renders notes list newest-first with author and timestamp
 *  - Error state when the fetch fails, with a retry button
 *  - Optimistic add: note appears immediately, confirmed on success
 *  - Optimistic rollback: note is removed and text restored on failure
 *  - Character-limit counter and submit button disabled states
 */

import React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TradeNotesPanel } from "../TradeNotesPanel";

// ── API mock ──────────────────────────────────────────────────────────────────
const mockGetNotes = jest.fn();
const mockAddNote = jest.fn();

jest.mock("@/lib/api", () => ({
  api: {
    trades: {
      getNotes: (...args: unknown[]) => mockGetNotes(...args),
      addNote: (...args: unknown[]) => mockAddNote(...args),
    },
  },
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.name = "ApiError";
      this.status = status;
    }
  },
}));

// ── Helpers ───────────────────────────────────────────────────────────────────
const TOKEN = "test-token-123";
const TRADE_ID = "TRD-001";

const NOTE_A = {
  id: "note-1",
  tradeId: TRADE_ID,
  authorAddress: "GBCABC123DEF",
  authorName: "Alice",
  body: "First note here",
  createdAt: "2026-04-20T09:00:00.000Z",
};

const NOTE_B = {
  id: "note-2",
  tradeId: TRADE_ID,
  authorAddress: "GBCXYZ456GHI000000000000000000000000000000000000000001",
  body: "Second note here",
  createdAt: "2026-04-21T10:00:00.000Z", // newer
};

function renderPanel(overrides?: { token?: string | null }) {
  return render(
    <TradeNotesPanel
      tradeId={TRADE_ID}
      token={overrides?.token !== undefined ? overrides.token : TOKEN}
    />,
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────
describe("TradeNotesPanel", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── Empty state ─────────────────────────────────────────────────────────────
  describe("empty state", () => {
    it("shows the empty-state message when there are no notes", async () => {
      mockGetNotes.mockResolvedValueOnce({ notes: [] });

      renderPanel();

      await waitFor(() =>
        expect(screen.getByTestId("notes-empty")).toBeInTheDocument(),
      );
      expect(screen.getByTestId("notes-empty")).toHaveTextContent(
        /No notes yet/i,
      );
    });
  });

  // ── List state ──────────────────────────────────────────────────────────────
  describe("list state", () => {
    it("renders the notes list when notes exist", async () => {
      mockGetNotes.mockResolvedValueOnce({ notes: [NOTE_A, NOTE_B] });

      renderPanel();

      const list = await screen.findByTestId("notes-list");
      expect(list).toBeInTheDocument();
    });

    it("shows notes newest-first", async () => {
      mockGetNotes.mockResolvedValueOnce({ notes: [NOTE_A, NOTE_B] });

      renderPanel();

      await screen.findByTestId("notes-list");

      const items = screen.getAllByRole("listitem");
      // NOTE_B (newer) should appear before NOTE_A
      expect(items[0]).toHaveTextContent("Second note here");
      expect(items[1]).toHaveTextContent("First note here");
    });

    it("displays the author name when available", async () => {
      mockGetNotes.mockResolvedValueOnce({ notes: [NOTE_A] });

      renderPanel();

      await screen.findByTestId("notes-list");
      expect(screen.getByText("Alice")).toBeInTheDocument();
    });

    it("shows a truncated wallet address when no author name is provided", async () => {
      mockGetNotes.mockResolvedValueOnce({ notes: [NOTE_B] });

      renderPanel();

      await screen.findByTestId("notes-list");
      // formatAuthor truncates: first 6 chars + … + last 4 chars
      // GBCXYZ456GHI000000000000000000000000000000000000000001
      // → GBCXYZ…0001
      expect(screen.getByText(/GBCXYZ…0001/i)).toBeInTheDocument();
    });

    it("renders the note body text", async () => {
      mockGetNotes.mockResolvedValueOnce({ notes: [NOTE_A] });

      renderPanel();

      await screen.findByTestId("notes-list");
      expect(screen.getByText("First note here")).toBeInTheDocument();
    });
  });

  // ── Error state ─────────────────────────────────────────────────────────────
  describe("error state", () => {
    it("shows the error message when the fetch fails", async () => {
      mockGetNotes.mockRejectedValueOnce(new Error("Network error"));

      renderPanel();

      await waitFor(() =>
        expect(screen.getByTestId("notes-error")).toBeInTheDocument(),
      );
      expect(screen.getByTestId("notes-error")).toHaveTextContent(
        /Network error/i,
      );
    });

    it("shows a retry button that re-fetches", async () => {
      mockGetNotes
        .mockRejectedValueOnce(new Error("Network error"))
        .mockResolvedValueOnce({ notes: [NOTE_A] });

      const user = userEvent.setup();
      renderPanel();

      await waitFor(() => screen.getByTestId("notes-error"));

      const retryBtn = within(screen.getByTestId("notes-error")).getByRole(
        "button",
        { name: /retry/i },
      );
      await user.click(retryBtn);

      await screen.findByTestId("notes-list");
      expect(mockGetNotes).toHaveBeenCalledTimes(2);
    });
  });

  // ── Composer: unauthenticated ────────────────────────────────────────────────
  describe("when no token is provided", () => {
    it("does not render the composer form", async () => {
      mockGetNotes.mockResolvedValueOnce({ notes: [] });

      renderPanel({ token: null });

      await screen.findByTestId("notes-empty");
      expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    });
  });

  // ── Composer: character limit ────────────────────────────────────────────────
  describe("character limit", () => {
    it("shows remaining character count", async () => {
      mockGetNotes.mockResolvedValueOnce({ notes: [] });
      const user = userEvent.setup();

      renderPanel();

      await screen.findByTestId("notes-empty");

      const textarea = screen.getByRole("textbox");
      await user.type(textarea, "Hello");

      expect(screen.getByText(/495 remaining/i)).toBeInTheDocument();
    });

    it("disables the Post button when the textarea is empty", async () => {
      mockGetNotes.mockResolvedValueOnce({ notes: [] });

      renderPanel();

      await screen.findByTestId("notes-empty");

      expect(screen.getByRole("button", { name: /post/i })).toBeDisabled();
    });
  });

  // ── Optimistic add ───────────────────────────────────────────────────────────
  describe("optimistic add", () => {
    it("shows the new note immediately before the server responds", async () => {
      mockGetNotes.mockResolvedValueOnce({ notes: [] });

      let resolveAdd!: (v: unknown) => void;
      mockAddNote.mockReturnValueOnce(
        new Promise((res) => {
          resolveAdd = res;
        }),
      );

      const user = userEvent.setup();
      renderPanel();

      await screen.findByTestId("notes-empty");

      const textarea = screen.getByRole("textbox");
      await user.type(textarea, "Optimistic note");
      await user.click(screen.getByRole("button", { name: /post/i }));

      // The note should appear immediately.
      expect(screen.getByText("Optimistic note")).toBeInTheDocument();

      // Now resolve the server response.
      resolveAdd({
        note: {
          id: "note-99",
          tradeId: TRADE_ID,
          authorAddress: "GBCME00000000001",
          body: "Optimistic note",
          createdAt: new Date().toISOString(),
        },
      });

      await waitFor(() =>
        expect(screen.getByTestId("note-item-note-99")).toBeInTheDocument(),
      );
    });

    it("rolls back the optimistic note on API failure and restores body", async () => {
      mockGetNotes.mockResolvedValueOnce({ notes: [] });
      mockAddNote.mockRejectedValueOnce(new Error("Server error"));

      const user = userEvent.setup();
      renderPanel();

      await screen.findByTestId("notes-empty");

      const textarea = screen.getByRole("textbox");
      await user.type(textarea, "Will fail note");
      await user.click(screen.getByRole("button", { name: /post/i }));

      // After rollback the notes list should be gone (empty state restored)
      await waitFor(() =>
        expect(screen.getByTestId("notes-empty")).toBeInTheDocument(),
      );

      // The body text should be restored in the textarea.
      expect(textarea).toHaveValue("Will fail note");

      // An error message should be shown.
      expect(screen.getByRole("alert")).toHaveTextContent(/Server error/i);
    });
  });
});
