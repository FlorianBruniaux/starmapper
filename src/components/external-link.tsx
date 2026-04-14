// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import type { AnchorHTMLAttributes, ReactNode } from "react";

type Props = AnchorHTMLAttributes<HTMLAnchorElement> & {
  href: string;
  children: ReactNode;
  /** When true (default), appends a sr-only " (opens in new tab)" hint */
  announceNewTab?: boolean;
};

/**
 * External link — always opens in a new tab with proper security attributes.
 * Appends a sr-only "opens in new tab" hint so screen reader users know
 * the link will leave the current context.
 */
export const ExternalLink = ({
  href,
  children,
  announceNewTab = true,
  className,
  ...rest
}: Props) => (
  <a
    href={href}
    target="_blank"
    rel="noopener noreferrer"
    className={className}
    {...rest}
  >
    {children}
    {announceNewTab && (
      <span className="sr-only"> (opens in new tab)</span>
    )}
  </a>
);
