// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TokenModal } from "./token-modal";

// getStoredToken / setStoredToken read sessionStorage which jsdom provides,
// but return "" when empty — safe without mocking.

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("TokenModal", () => {
  it("renders without crashing when mounted", () => {
    render(<TokenModal onClose={vi.fn()} />);
    // The modal renders a dialog role
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("displays the modal title", () => {
    render(<TokenModal onClose={vi.fn()} />);
    expect(screen.getByText("GitHub Access Token")).toBeInTheDocument();
  });

  it("renders the password input field", () => {
    render(<TokenModal onClose={vi.fn()} />);
    const input = screen.getByLabelText("Personal Access Token");
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute("type", "password");
  });

  it("accepts text input in the token field", () => {
    render(<TokenModal onClose={vi.fn()} />);
    const input = screen.getByLabelText("Personal Access Token") as HTMLInputElement;

    fireEvent.change(input, { target: { value: "ghp_testtoken123" } });

    expect(input.value).toBe("ghp_testtoken123");
  });

  it("renders a Save button", () => {
    render(<TokenModal onClose={vi.fn()} />);
    expect(screen.getByRole("button", { name: /save/i })).toBeInTheDocument();
  });

  it("renders a Remove token button", () => {
    render(<TokenModal onClose={vi.fn()} />);
    expect(screen.getByRole("button", { name: /remove token/i })).toBeInTheDocument();
  });

  it("calls onClose when the modal backdrop is clicked", () => {
    const onClose = vi.fn();
    render(<TokenModal onClose={onClose} />);

    // The backdrop is the outermost dialog element — clicking it (not a child) triggers onClose
    const dialog = screen.getByRole("dialog");
    fireEvent.click(dialog);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when ESC key is pressed", () => {
    const onClose = vi.fn();
    render(<TokenModal onClose={onClose} />);

    fireEvent.keyDown(document, { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("clears the input when Remove token is clicked", () => {
    render(<TokenModal onClose={vi.fn()} />);
    const input = screen.getByLabelText("Personal Access Token") as HTMLInputElement;

    fireEvent.change(input, { target: { value: "ghp_testtoken123" } });
    expect(input.value).toBe("ghp_testtoken123");

    fireEvent.click(screen.getByRole("button", { name: /remove token/i }));

    expect(input.value).toBe("");
  });
});
