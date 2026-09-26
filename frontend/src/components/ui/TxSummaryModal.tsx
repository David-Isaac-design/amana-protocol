"use client";

/**
 * TxSummaryModal — human-readable transaction summary before Freighter signing.
 *
 * Shown after the backend returns an unsigned XDR but before `signTransaction`
 * is called.  Decodes the operation intent from well-known action labels and
 * displays amount + counterparty so the user knows exactly what they are
 * approving. (#71)
 *
 * Keyboard flow:
 *  - Focus moves to the Cancel button (safe default) on open.
 *  - Escape closes without signing.
 *  - Tab cycles within the dialog (Radix Dialog focus trap).
 */

import * as React from "react";
import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalTitle,
  ModalDescription,
  ModalFooter,
} from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TxSummaryItem {
  label: string;
  value: string;
}

export interface TxSummaryModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Human-readable action name (e.g. "Deposit Funds", "Release Funds").
   * Shown as the modal title.
   */
  actionLabel: string;
  /**
   * Structured key/value pairs extracted from the trade that describe
   * what this transaction will do.  Rendered as a definition list.
   */
  items: TxSummaryItem[];
  /** Called when the user confirms and wants Freighter to sign. */
  onConfirm: () => void;
  /** Whether the signing request is in-flight. */
  loading?: boolean;
}

// ─── Icon helpers ─────────────────────────────────────────────────────────────

function ShieldIcon() {
  return (
    <svg
      className="w-5 h-5 text-gold"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z"
      />
    </svg>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function TxSummaryModal({
  open,
  onOpenChange,
  actionLabel,
  items,
  onConfirm,
  loading = false,
}: TxSummaryModalProps) {
  const cancelRef = React.useRef<HTMLButtonElement>(null);

  // Move focus to Cancel (safe default) once the dialog mounts.
  React.useEffect(() => {
    if (open) {
      const raf = requestAnimationFrame(() => {
        cancelRef.current?.focus();
      });
      return () => cancelAnimationFrame(raf);
    }
  }, [open]);

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent
        onOpenAutoFocus={(e) => e.preventDefault()}
        role="alertdialog"
        aria-live="assertive"
      >
        <ModalHeader>
          <div className="flex items-center gap-2 mb-1">
            <ShieldIcon />
            <ModalTitle>Review Transaction</ModalTitle>
          </div>
          <ModalDescription>
            You are about to sign a Stellar transaction for{" "}
            <strong className="text-text-primary">{actionLabel}</strong> using
            Freighter. Please review the details below before approving.
          </ModalDescription>
        </ModalHeader>

        {/* Transaction summary */}
        <div className="mt-4 rounded-lg border border-border-default bg-surface-1 divide-y divide-border-default overflow-hidden">
          {items.map(({ label, value }) => (
            <div key={label} className="flex items-start justify-between gap-4 px-4 py-3">
              <dt className="text-xs uppercase tracking-wide text-text-muted whitespace-nowrap shrink-0">
                {label}
              </dt>
              <dd className="text-sm font-medium text-text-primary text-right font-mono break-all">
                {value}
              </dd>
            </div>
          ))}
        </div>

        <p className="mt-4 text-xs text-text-muted">
          Freighter will open and ask for your wallet password. The signed
          transaction will be submitted to the Stellar network immediately.
        </p>

        <ModalFooter>
          <Button
            ref={cancelRef}
            variant="secondary"
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
            Cancel
          </Button>

          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            aria-label={`Sign and submit ${actionLabel}`}
            aria-busy={loading}
            data-testid="tx-summary-confirm"
            className={[
              "px-4 py-2 text-sm font-semibold rounded-md",
              "bg-gold text-text-inverse",
              "hover:bg-gold-hover",
              "transition-opacity",
              "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold",
              "disabled:opacity-60 disabled:cursor-not-allowed",
            ].join(" ")}
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <span
                  className="inline-block h-3.5 w-3.5 rounded-full border-2 border-transparent border-t-current animate-spin"
                  aria-hidden="true"
                />
                Waiting for Freighter…
              </span>
            ) : (
              `Sign with Freighter`
            )}
          </button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

export default TxSummaryModal;
