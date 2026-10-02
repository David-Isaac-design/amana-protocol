"use client";

import Link from "next/link";
import { EmptyState } from "@/components/ui/EmptyState";

function NotFoundIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-6 w-6"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
      <line x1="11" y1="8" x2="11" y2="11" />
      <line x1="11" y1="14" x2="11.01" y2="14" />
    </svg>
  );
}

export default function NotFoundPage() {
  return (
    <div
      className="min-h-screen bg-bg-primary flex items-center justify-center"
      data-testid="not-found-page"
    >
      <EmptyState
        icon={<NotFoundIcon />}
        title="Page not found"
        description="The page you're looking for doesn't exist or has been moved."
        action={
          <Link
            href="/"
            className="rounded-lg bg-gold px-5 py-2 text-sm font-semibold text-text-inverse hover:bg-gold-hover transition-colors"
          >
            Go home
          </Link>
        }
      />
    </div>
  );
}
