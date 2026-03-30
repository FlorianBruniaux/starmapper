const ECOSYSTEM_LINKS = [
  { href: "https://cc.bruniaux.com/", label: "Claude Code Guide" },
  { href: "https://cowork.bruniaux.com/", label: "Cowork Guide" },
  { href: "https://ccboard.bruniaux.com/", label: "ccboard" },
  { href: "https://ccbridge.bruniaux.com/", label: "cc-copilot-bridge" },
  { href: "https://www.rtk-ai.app/", label: "RTK" },
];

const SOCIAL_LINKS = [
  { href: "https://bruniaux.com/", label: "Blog & Portfolio" },
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

      {/* Bottom bar */}
      <div className="border-t border-border-subtle pt-5 flex flex-col sm:flex-row justify-between items-center gap-3">
        <p className="text-xs text-muted">
          Made by{" "}
          <a
            href="https://bruniaux.com/"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Florian Bruniaux (opens in new tab)"
            className="text-accent-blue hover:underline"
          >
            Florian Bruniaux
          </a>
        </p>
        <p className="text-xs text-muted-subtle">
          Free forever · No account required
        </p>
      </div>
    </div>
  </footer>
);
