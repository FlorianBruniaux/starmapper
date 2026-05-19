// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RateLimitedModal } from "./rate-limited-modal";
import { RepoNotFoundModal } from "./not-found-modal";
import { RateLimitOverlay } from "./rate-limit-overlay";
import { PreScanOverlay } from "./pre-scan-overlay";
import { ShareModal } from "./share-modal";

vi.mock("next/image", () => ({
  default: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} />,
}));

beforeEach(() => {
  vi.restoreAllMocks();
});

const baseEstimate = { min: 5, max: 10, unit: "sec" as const, keepOpen: false };

// ── RateLimitedModal ──────────────────────────────────────────────────────────

describe("RateLimitedModal", () => {
  it("renders alertdialog when open", () => {
    render(<RateLimitedModal open onAddToken={vi.fn()} />);
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });

  it("returns null when not open", () => {
    const { container } = render(<RateLimitedModal open={false} onAddToken={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it("calls onAddToken when button is clicked", () => {
    const onAddToken = vi.fn();
    render(<RateLimitedModal open onAddToken={onAddToken} />);
    fireEvent.click(screen.getByText("Add a GitHub token"));
    expect(onAddToken).toHaveBeenCalledOnce();
  });
});

// ── RepoNotFoundModal ─────────────────────────────────────────────────────────

describe("RepoNotFoundModal", () => {
  it("renders alertdialog when open", () => {
    render(<RepoNotFoundModal open owner="vercel" repo="next.js" />);
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });

  it("returns null when not open", () => {
    const { container } = render(<RepoNotFoundModal open={false} owner="a" repo="b" />);
    expect(container.firstChild).toBeNull();
  });

  it("displays owner/repo in the body", () => {
    render(<RepoNotFoundModal open owner="vercel" repo="next.js" />);
    expect(screen.getByText("vercel/next.js")).toBeInTheDocument();
  });
});

// ── RateLimitOverlay ──────────────────────────────────────────────────────────

describe("RateLimitOverlay", () => {
  it("renders alertdialog when status is waiting", () => {
    render(<RateLimitOverlay status="waiting" waitReason="github" retryIn={60} retryTotal={120} />);
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });

  it("returns null when status is not waiting", () => {
    const { container } = render(
      <RateLimitOverlay status="idle" waitReason={null} retryIn={0} retryTotal={0} />
    );
    expect(container.firstChild).toBeNull();
  });

  it("displays the countdown value", () => {
    render(<RateLimitOverlay status="waiting" waitReason="github" retryIn={42} retryTotal={120} />);
    expect(screen.getByText("42")).toBeInTheDocument();
  });
});

// ── PreScanOverlay ────────────────────────────────────────────────────────────

describe("PreScanOverlay", () => {
  const minProps = {
    status: "idle" as const,
    cacheCheckDone: true,
    repoInfo: { name: "my-repo", description: null, avatar: null },
    estimate: baseEstimate,
    total: 500,
    lastDbScan: null,
    hasToken: false,
    onStart: vi.fn(),
  };

  it("renders dialog when status is idle and cacheCheckDone is true", () => {
    render(<PreScanOverlay {...minProps} />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("returns null when status is not idle", () => {
    const { container } = render(<PreScanOverlay {...minProps} status="loading" />);
    expect(container.firstChild).toBeNull();
  });

  it("returns null when cacheCheckDone is false", () => {
    const { container } = render(<PreScanOverlay {...minProps} cacheCheckDone={false} />);
    expect(container.firstChild).toBeNull();
  });

  it("calls onStart when the scan button is clicked", () => {
    const onStart = vi.fn();
    render(<PreScanOverlay {...minProps} onStart={onStart} />);
    fireEvent.click(screen.getByRole("button", { name: /start indexing/i }));
    expect(onStart).toHaveBeenCalledOnce();
  });
});

// ── ShareModal ────────────────────────────────────────────────────────────────

describe("ShareModal", () => {
  const baseProps = {
    open: true,
    onClose: vi.fn(),
    owner: "vercel",
    repo: "next.js",
    repoInfo: { name: "next.js", description: null, stars: 1000, avatar: null },
    points: [],
    displayStats: null,
    captureCanvas: vi.fn().mockResolvedValue(null),
    buildFilteredUrl: vi.fn().mockReturnValue("https://example.com"),
    filterCountry: "",
    filterCity: "",
    filterCompany: "",
    filterFollowers: 0,
    filterDate: "all" as const,
    followerMapFilter: "all" as const,
    viewMode: "clusters" as const,
    liDraft: "",
    onLiDraftChange: vi.fn(),
  };

  it("renders when open", () => {
    render(<ShareModal {...baseProps} />);
    expect(screen.getByText("Share")).toBeInTheDocument();
  });

  it("returns null when not open", () => {
    const { container } = render(<ShareModal {...baseProps} open={false} />);
    expect(container.firstChild).toBeNull();
  });

  it("textarea has aria-label='LinkedIn post draft' when LinkedIn panel is opened", () => {
    render(<ShareModal {...baseProps} />);
    fireEvent.click(screen.getByText("Share on LinkedIn"));
    expect(screen.getByLabelText("LinkedIn post draft")).toBeInTheDocument();
  });
});
