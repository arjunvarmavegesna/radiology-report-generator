"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Minimal controlled modal. Hand-written (NOT via `npx shadcn add`, which on
 * this project pulls Tailwind v4 + Base UI and breaks the build) but matching
 * the existing component conventions. Closes on overlay click + Escape.
 */
export function Modal({
  open,
  onClose,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-3"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        className={cn(
          "max-h-[90dvh] w-full max-w-2xl overflow-y-auto rounded-[14px] bg-card p-5 shadow-xl",
          className,
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
