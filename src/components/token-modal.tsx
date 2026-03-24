"use client";

import { useState } from "react";

const TOKEN_KEY = "gh_token";

export const getStoredToken = (): string => {
  try { return localStorage.getItem(TOKEN_KEY) ?? ""; } catch { return ""; }
};

export const setStoredToken = (token: string) => {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch { /* ignore */ }
};

interface Props {
  onClose: () => void;
}

export function TokenModal({ onClose }: Props) {
  const [value, setValue] = useState(() => getStoredToken());
  const [saved, setSaved] = useState(false);

  function handleSave() {
    setStoredToken(value.trim());
    setSaved(true);
    setTimeout(onClose, 600);
  }

  function handleRemove() {
    setStoredToken("");
    setValue("");
    setSaved(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-[#161b22] border border-[#30363d] rounded-xl w-full max-w-md shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#21262d]">
          <h2 className="text-white font-semibold text-base">GitHub Access Token</h2>
          <button
            onClick={onClose}
            className="text-[#8b949e] hover:text-white transition-colors text-xl leading-none"
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4">
          <p className="text-[#c9d1d9] text-sm leading-relaxed">
            StarMapper uses the GitHub API to fetch stargazers. Without a token, you're limited to{" "}
            <span className="text-[#f85149] font-medium">60 requests/hour</span> (unauthenticated).
            With your own token, you get{" "}
            <span className="text-[#3fb950] font-medium">5,000 requests/hour</span>.
          </p>
          <p className="text-[#8b949e] text-sm">
            No scopes needed — a{" "}
            <a
              href="https://github.com/settings/tokens/new?description=StarMapper&scopes="
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#58a6ff] hover:underline"
            >
              public-only token
            </a>{" "}
            is enough. It's stored only in your browser's localStorage, never sent to our servers
            except as an API relay header.
          </p>

          <div>
            <label className="block text-[#e6edf3] text-xs font-medium mb-1.5">
              Personal Access Token
            </label>
            <input
              type="password"
              value={value}
              onChange={(e) => { setValue(e.target.value); setSaved(false); }}
              placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
              className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2.5 text-white placeholder-[#484f58] focus:outline-none focus:border-[#58a6ff] text-sm font-mono transition-colors"
              autoFocus
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-[#21262d] gap-3">
          <button
            onClick={handleRemove}
            className="text-[#8b949e] hover:text-[#f85149] text-sm transition-colors"
          >
            Remove token
          </button>
          <button
            onClick={handleSave}
            className={`px-5 py-2 rounded-lg text-sm font-medium transition-colors ${
              saved
                ? "bg-[#238636] text-white"
                : "bg-[#238636] hover:bg-[#2ea043] text-white"
            }`}
          >
            {saved ? "Saved ✓" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
