// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

"use client";

import { useState } from "react";
import { Shield } from "lucide-react";
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
    <Modal open title="Speed Boost: GitHub Token" onClose={onClose} maxWidth="max-w-lg">
      {/* Body */}
      <div className="px-6 py-5 space-y-4">
        <div className="flex items-start gap-2.5 bg-accent-green/8 border border-accent-green/20 rounded-lg px-4 py-3">
          <Shield size={14} className="text-accent-green mt-0.5 flex-shrink-0" aria-hidden="true" />
          <p className="text-xs text-muted leading-relaxed">
            <span className="text-foreground font-medium">No account, no login, no signup.</span>{" "}
            A GitHub token is just a speed pass for the API. It never gives StarMapper access to your repos or private data.
          </p>
        </div>
        <p className="text-foreground text-sm leading-relaxed">
          StarMapper reads public stargazer data from the GitHub API. Without a token, you share{" "}
          <span className="text-accent-red font-medium">60 requests/hour</span> with everyone.
          With your token:{" "}
          <span className="text-accent-green font-medium">5,000 requests/hour</span> dedicated to you.
        </p>
        <p className="text-muted text-sm">
          <a
            href="https://github.com/settings/tokens/new?description=StarMapper&scopes="
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Create a free GitHub token with zero permissions (opens in new tab)"
            className="text-accent-blue hover:underline"
          >
            Create a free token (zero permissions)
          </a>{" "}
          in 30 seconds. Stored in your browser for 15 days, then auto-cleared.
        </p>

        <div>
          <label htmlFor="gh-token-input" className="block text-foreground text-xs font-medium mb-1.5">
            GitHub Token (no permissions needed)
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
