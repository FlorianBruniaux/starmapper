// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

"use client";

import { useState } from "react";
import { Modal } from "@/components/modal";
import {
  getStoredToken,
  setStoredToken,
  getStoredUsername,
  setStoredUsername,
} from "@/lib/token";

// Re-export so existing callers don't break
export { getStoredToken, setStoredToken, getStoredUsername, setStoredUsername };

type Props = {
  onClose: () => void;
};

export const TokenModal = ({ onClose }: Props) => {
  const [value, setValue] = useState(() => getStoredToken());
  const [saved, setSaved] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);

  const handleSave = async () => {
    const token = value.trim();
    setStoredToken(token);

    if (token) {
      setIsVerifying(true);
      try {
        const res = await fetch("https://api.github.com/user", {
          headers: { Authorization: `token ${token}`, "User-Agent": "starmapper/1.0" },
          signal: AbortSignal.timeout(4000),
        });
        if (res.ok) {
          const data = await res.json() as { login?: string };
          if (typeof data.login === "string") setStoredUsername(data.login.toLowerCase());
        }
      } catch { /* non-fatal — token still saved */ }
      setIsVerifying(false);
    } else {
      setStoredUsername("");
    }

    setSaved(true);
    setTimeout(onClose, 600);
  };

  const handleRemove = () => {
    setStoredToken("");
    setStoredUsername("");
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
          No scopes needed. A{" "}
          <a
            href="https://github.com/settings/tokens/new?description=StarMapper&scopes="
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Create a public-only GitHub token (opens in new tab)"
            className="text-accent-blue hover:underline"
          >
            public-only token
          </a>{" "}
          is enough. It's stored only in your browser's session memory (auto-cleared after
          30 minutes or when you close the tab), never persisted to our servers except as an API relay header.
        </p>

        <div>
          <label htmlFor="gh-token-input" className="block text-foreground text-xs font-medium mb-1.5">
            Personal Access Token
          </label>
          <input
            id="gh-token-input"
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
          type="button"
          onClick={handleRemove}
          className="text-muted hover:text-accent-red text-sm transition-colors"
        >
          Remove token
        </button>
        <button
          type="button"
          onClick={handleSave}
          className="px-5 py-2 rounded-lg text-sm font-medium bg-accent-green-emphasis hover:opacity-90 text-white transition-opacity"
          aria-live="polite"
          disabled={isVerifying}
        >
          {isVerifying ? "Verifying…" : saved ? <>Saved <span aria-hidden="true">✓</span></> : "Save"}
        </button>
      </div>
    </Modal>
  );
};
