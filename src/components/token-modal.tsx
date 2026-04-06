// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

"use client";

import { useState } from "react";
import { Modal } from "@/components/modal";

const TOKEN_KEY = "gh_token";
const USERNAME_KEY = "gh_username";

// 30-minute TTL — token is cleared automatically after inactivity.
// sessionStorage is preferred over localStorage: it never persists across
// browser sessions and is not accessible by other tabs.
const TOKEN_TTL_MS = 30 * 60 * 1000;

type StoredValue = { v: string; exp: number };

const readSession = (key: string): string => {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return "";
    const parsed: StoredValue = JSON.parse(raw);
    if (parsed.exp < Date.now()) {
      sessionStorage.removeItem(key);
      return "";
    }
    return parsed.v;
  } catch { return ""; }
};

const writeSession = (key: string, value: string) => {
  try {
    if (value) {
      sessionStorage.setItem(key, JSON.stringify({ v: value, exp: Date.now() + TOKEN_TTL_MS }));
    } else {
      sessionStorage.removeItem(key);
    }
  } catch { /* ignore */ }
};

export const getStoredToken = (): string => readSession(TOKEN_KEY);

export const setStoredToken = (token: string) => writeSession(TOKEN_KEY, token);

export const getStoredUsername = (): string => readSession(USERNAME_KEY);

export const setStoredUsername = (username: string) => writeSession(USERNAME_KEY, username);

type Props = {
  onClose: () => void;
};

export const TokenModal = ({ onClose }: Props) => {
  const [value, setValue] = useState(() => getStoredToken());
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    setStoredToken(value.trim());
    setSaved(true);
    setTimeout(onClose, 600);
  };

  const handleRemove = () => {
    setStoredToken("");
    setValue("");
    setSaved(false);
  };

  return (
    <Modal open title="GitHub Access Token" onClose={onClose}>
      {/* Body */}
      <div className="px-6 py-5 space-y-4">
        <p className="text-foreground text-sm leading-relaxed">
          StarMapper uses the GitHub API to fetch stargazers. Without a token, you're limited to{" "}
          <span className="text-accent-red font-medium">60 requests/hour</span> (unauthenticated).
          With your own token, you get{" "}
          <span className="text-accent-green font-medium">5,000 requests/hour</span>.
        </p>
        <p className="text-muted text-sm">
          No scopes needed — a{" "}
          <a
            href="https://github.com/settings/tokens/new?description=StarMapper&scopes="
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent-blue hover:underline"
          >
            public-only token
          </a>{" "}
          is enough. It's stored only in your browser's session memory (auto-cleared after
          30 minutes or when you close the tab), never persisted to our servers except as an API relay header.
        </p>

        <div>
          <label className="block text-foreground text-xs font-medium mb-1.5">
            Personal Access Token
          </label>
          <input
            type="password"
            value={value}
            onChange={(e) => { setValue(e.target.value); setSaved(false); }}
            placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
            className="w-full bg-background border border-border rounded-lg px-3 py-2.5 text-foreground placeholder-muted-subtle focus:outline-none focus:border-accent-blue text-sm font-mono transition-colors"
            autoFocus
          />
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-6 py-4 border-t border-border-subtle gap-3">
        <button
          onClick={handleRemove}
          className="text-muted hover:text-accent-red text-sm transition-colors"
        >
          Remove token
        </button>
        <button
          onClick={handleSave}
          className="px-5 py-2 rounded-lg text-sm font-medium bg-accent-green-emphasis hover:opacity-90 text-white transition-opacity"
        >
          {saved ? "Saved ✓" : "Save"}
        </button>
      </div>
    </Modal>
  );
};
