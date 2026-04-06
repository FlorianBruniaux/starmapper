// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

const ECOSYSTEM_LINKS = [
  { href: "https://cc.bruniaux.com/", label: "Claude Code Guide" },
  { href: "https://cowork.bruniaux.com/", label: "Cowork Guide" },
  { href: "https://ccboard.bruniaux.com/", label: "ccboard" },
  { href: "https://ccbridge.bruniaux.com/", label: "cc-copilot-bridge" },
  { href: "https://www.rtk-ai.app/", label: "RTK" },
];

const SOCIAL_LINKS = [
  { href: "https://florian.bruniaux.com/", label: "Blog & Portfolio" },
  { href: "https://www.devw.ai/", label: "Dev With AI (FR)" },
  { href: "https://github.com/FlorianBruniaux", label: "GitHub" },
];

export const Footer = () => (
  <footer className="border-t border-border-subtle mt-0 bg-background">
    <div className="mx-auto max-w-5xl px-6 py-10">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-8 mb-8">
        {/* Brand */}
        <div className="sm:col-span-1">
          <div className="flex items-center gap-2 mb-3">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5" className="text-accent-blue" />
              <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" stroke="currentColor" strokeWidth="1.5" className="text-accent-blue" />
            </svg>
            <span className="text-foreground font-semibold text-sm">StarMapper</span>
          </div>
          <p className="text-muted text-xs leading-relaxed">
            See who stars your repo, on a map. Free, no login required.
          </p>
        </div>

        {/* Ecosystem */}
        <div>
          <h3 className="text-foreground text-xs font-semibold uppercase tracking-widest mb-3">
            Ecosystem
          </h3>
          <ul className="space-y-2">
            {ECOSYSTEM_LINKS.map(({ href, label }) => (
              <li key={href}>
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`${label} (opens in new tab)`}
                  className="text-muted hover:text-foreground text-xs transition-colors"
                >
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </div>

        {/* Author */}
        <div>
          <h3 className="text-foreground text-xs font-semibold uppercase tracking-widest mb-3">
            Author
          </h3>
          <ul className="space-y-2">
            {SOCIAL_LINKS.map(({ href, label }) => (
              <li key={href}>
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`${label} (opens in new tab)`}
                  className="text-muted hover:text-foreground text-xs transition-colors"
                >
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Legal links */}
      <div className="border-t border-border-subtle pt-5 pb-4 flex flex-wrap gap-4">
        <a href="/privacy" className="text-2xs text-muted-subtle hover:text-muted transition-colors">Privacy Policy</a>
        <a href="/terms" className="text-2xs text-muted-subtle hover:text-muted transition-colors">Terms of Service</a>
        <a href="/legal" className="text-2xs text-muted-subtle hover:text-muted transition-colors">Legal</a>
        <a href="mailto:florian@bruniaux.com" className="text-2xs text-muted-subtle hover:text-muted transition-colors">florian@bruniaux.com</a>
      </div>

      {/* Bottom bar */}
      <div className="border-t border-border-subtle pt-5 flex flex-col sm:flex-row justify-between items-center gap-3">
        <div className="flex items-center gap-2">
          <a
            href="https://florian.bruniaux.com/"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Portfolio of Florian Bruniaux (opens in new tab)"
            className="text-2xs text-accent-orange/80 hover:text-accent-orange transition-colors bg-surface px-2.5 py-1 rounded-full border border-accent-orange/20 hover:border-accent-orange/50"
          >
            by Florian Bruniaux
          </a>
          <a
            href="https://github.com/FlorianBruniaux"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Follow on GitHub (opens in new tab)"
            className="flex items-center gap-1.5 text-2xs text-muted/80 hover:text-foreground transition-colors bg-surface px-2.5 py-1 rounded-full border border-border/40 hover:border-accent-blue/40"
          >
            <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z" />
            </svg>
            Follow
          </a>
        </div>
        <p className="text-xs text-muted-subtle">
          Free forever · No account required
        </p>
      </div>
    </div>
  </footer>
);
