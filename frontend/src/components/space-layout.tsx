"use client";

/**
 * SpaceLayout — canonical page-level layout wrapper.
 *
 * Provides a consistent padded content area inside the AppShell.
 * Previously two identical files (space-layout.tsx and space-layout-v2.tsx)
 * existed with wrong content; this is the single merged canonical version.
 * space-layout-v2.tsx has been deleted (#69).
 *
 * Usage:
 *   import { SpaceLayout } from "@/components/space-layout";
 *   <SpaceLayout title="My Page">…content…</SpaceLayout>
 */

import React from "react";

export interface SpaceLayoutProps {
  /** Optional page-level heading rendered above children. */
  title?: string;
  /** Optional description rendered below the title. */
  description?: string;
  /** Slot for header-level actions (buttons, menus) aligned to the right. */
  actions?: React.ReactNode;
  /** Page content. */
  children: React.ReactNode;
  /** Extra class names applied to the outer container. */
  className?: string;
}

/**
 * SpaceLayout wraps page content with standard horizontal padding,
 * a max-width constraint, and an optional title/actions header row.
 */
export function SpaceLayout({
  title,
  description,
  actions,
  children,
  className = "",
}: SpaceLayoutProps) {
  return (
    <div className={`px-6 py-8 max-w-6xl mx-auto ${className}`}>
      {(title || actions) && (
        <div className="flex items-center justify-between mb-6">
          <div>
            {title && (
              <h1 className="text-2xl font-semibold text-text-primary">
                {title}
              </h1>
            )}
            {description && (
              <p className="mt-1 text-sm text-text-secondary">{description}</p>
            )}
          </div>
          {actions && (
            <div className="flex items-center gap-2">{actions}</div>
          )}
        </div>
      )}
      {children}
    </div>
  );
}

export default SpaceLayout;
