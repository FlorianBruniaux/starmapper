// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

"use client";

import { useEffect, useId, useRef } from "react";
import { useFocusTrap } from "@/hooks/use-focus-trap";

type Props = {
  open: boolean;
  onClose: () => void;
  title?: string;
  ariaLabel?: string;
  maxWidth?: string;
  innerClassName?: string;
  children: React.ReactNode;
};

export const Modal = ({ open, onClose, title, ariaLabel, maxWidth = "max-w-md", innerClassName = "", children }: Props) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useFocusTrap(dialogRef, open, onClose);

  // Prevent body scroll while open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4
                 animate-in fade-in duration-150"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-labelledby={title ? titleId : undefined}
      aria-label={title ? undefined : ariaLabel}
    >
      <div
        ref={dialogRef}
        className={`bg-surface border border-border rounded-xl w-full ${maxWidth} shadow-2xl animate-in zoom-in-95 duration-150 ${innerClassName}`}
      >
        {title && (
          <div className="flex items-center justify-between px-6 py-4 border-b border-border-subtle">
            <h2 id={titleId} className="text-foreground font-semibold text-base">{title}</h2>
            <button
              onClick={onClose}
              className="text-muted hover:text-foreground transition-colors text-xl leading-none"
              aria-label="Close"
            >
              ×
            </button>
          </div>
        )}
        {children}
      </div>
    </div>
  );
};
