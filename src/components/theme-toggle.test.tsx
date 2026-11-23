// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, render, screen, fireEvent } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { ThemeToggle } from "./theme-toggle";

// jsdom does not implement window.matchMedia — stub it before any import
// that reads system preference. Default: system prefers dark.
beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn((query: string) => ({
      matches: query === "(prefers-color-scheme: light)" ? false : false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });

  // Reset html classes and localStorage between tests
  document.documentElement.className = "";
  localStorage.clear();
});

describe("ThemeToggle", () => {
  it("hydrates the server icon without recovery when a light preference is stored", async () => {
    let markup: string;
    vi.stubGlobal("window", undefined);
    try {
      markup = renderToString(<ThemeToggle />);
    } finally {
      vi.unstubAllGlobals();
    }
    localStorage.setItem("starmapper:theme", "light");
    const container = document.createElement("div");
    container.innerHTML = markup;
    document.body.appendChild(container);
    const onRecoverableError = vi.fn();
    let root: Root | undefined;
    try {
      await act(async () => {
        root = hydrateRoot(container, <ThemeToggle />, { onRecoverableError });
      });
      expect(container.querySelector("button")).toHaveAttribute("aria-label", "Switch to dark mode");
      expect(onRecoverableError).not.toHaveBeenCalled();
    } finally {
      await act(async () => { root?.unmount(); });
      container.remove();
    }
  });

  it("renders without crashing", () => {
    render(<ThemeToggle />);
    const btn = screen.getByRole("button");
    expect(btn).toBeInTheDocument();
  });

  it("has a descriptive aria-label based on current theme", () => {
    render(<ThemeToggle />);
    const btn = screen.getByRole("button");
    // Either label is valid — the component reflects the resolved theme
    const label = btn.getAttribute("aria-label");
    expect(["Switch to light mode", "Switch to dark mode"]).toContain(label);
  });

  it("clicking the toggle applies the opposite theme class to <html>", () => {
    // Force dark theme to start from a known state
    localStorage.setItem("starmapper:theme", "dark");
    document.documentElement.classList.add("dark");

    render(<ThemeToggle />);
    const btn = screen.getByRole("button");

    fireEvent.click(btn);

    // After toggling from dark, html should carry "light"
    expect(document.documentElement.classList.contains("light")).toBe(true);
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("toggling twice returns to the original theme class", () => {
    localStorage.setItem("starmapper:theme", "dark");
    document.documentElement.classList.add("dark");

    render(<ThemeToggle />);
    const btn = screen.getByRole("button");

    fireEvent.click(btn); // dark → light
    fireEvent.click(btn); // light → dark

    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.classList.contains("light")).toBe(false);
  });

  it("accepts an optional className prop without crashing", () => {
    render(<ThemeToggle className="extra-class" />);
    expect(screen.getByRole("button")).toBeInTheDocument();
  });
});
