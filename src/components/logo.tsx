// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

export const LogoMark = () => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 20 20"
    fill="none"
    aria-hidden="true"
    className="text-accent-blue flex-shrink-0"
  >
    <circle cx="10" cy="10" r="7.5" stroke="currentColor" strokeWidth="1.2" />
    <ellipse cx="10" cy="10" rx="3.5" ry="7.5" stroke="currentColor" strokeWidth="1" opacity="0.7" />
    <line x1="2.5" y1="10" x2="17.5" y2="10" stroke="currentColor" strokeWidth="1" opacity="0.7" />
    <path d="M3.5 6.8 Q10 5.4 16.5 6.8" stroke="currentColor" strokeWidth="0.8" fill="none" opacity="0.5" />
    <path d="M3.5 13.2 Q10 14.6 16.5 13.2" stroke="currentColor" strokeWidth="0.8" fill="none" opacity="0.5" />
    <path
      d="M10 4.2 L10.5 5.9 L12.3 5.9 L10.9 7.0 L11.4 8.7 L10 7.7 L8.6 8.7 L9.1 7.0 L7.7 5.9 L9.5 5.9 Z"
      fill="#f0a050"
    />
  </svg>
);
