export default defineContentScript({
  // Single-segment paths for profile pages + two-segment for repo pages
  matches: ["https://github.com/*", "https://github.com/*/*"],
  runAt: "document_end",

  main() {
    const STARMAPPER = "https://starmapper.bruniaux.com";
    const REPO_BTN_ID = "starmapper-map-btn";
    const PROFILE_BTN_ID = "starmapper-profile-btn";
    const STORAGE_KEY = "recentRepos";
    const MAX_RECENT = 5;

    const SYSTEM_OWNERS = new Set([
      "settings", "notifications", "explore", "trending", "marketplace",
      "features", "pricing", "about", "security", "login", "signup",
      "organizations", "orgs", "apps", "topics", "collections", "events",
      "sponsors", "readme",
    ]);

    type PageContext =
      | { kind: "repo"; slug: string }
      | { kind: "profile"; login: string }
      | { kind: "other" };

    const getPageContext = (): PageContext => {
      if (location.hostname !== "github.com") return { kind: "other" };
      const parts = location.pathname.split("/").filter(Boolean);
      if (parts.length === 2 && !SYSTEM_OWNERS.has(parts[0])) {
        return { kind: "repo", slug: `${parts[0]}/${parts[1]}` };
      }
      if (parts.length === 1 && !SYSTEM_OWNERS.has(parts[0])) {
        return { kind: "profile", login: parts[0] };
      }
      return { kind: "other" };
    };

    const removeAllButtons = (): void => {
      document.getElementById(REPO_BTN_ID)?.remove();
      document.getElementById(PROFILE_BTN_ID)?.remove();
    };

    const STAR_SVG = `<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" style="flex-shrink:0">
      <path d="M8 .25a.75.75 0 01.673.418l1.882 3.815 4.21.612a.75.75 0 01.416 1.279l-3.046 2.97.719 4.192a.75.75 0 01-1.088.791L8 12.347l-3.766 1.98a.75.75 0 01-1.088-.79l.72-4.194L.818 6.374a.75.75 0 01.416-1.28l4.21-.611L7.327.668A.75.75 0 018 .25z"/>
    </svg>`;

    const applyButtonBaseStyle = (btn: HTMLAnchorElement): void => {
      Object.assign(btn.style, {
        display: "inline-flex",
        alignItems: "center",
        gap: "4px",
        padding: "4px 10px",
        fontSize: "12px",
        fontWeight: "500",
        lineHeight: "20px",
        color: "var(--button-default-fgColor-rest, #24292f)",
        backgroundColor: "var(--button-default-bgColor-rest, #f6f8fa)",
        border: "1px solid var(--button-default-borderColor-rest, rgba(31,35,40,.15))",
        borderRadius: "6px",
        textDecoration: "none",
        whiteSpace: "nowrap",
        cursor: "pointer",
        fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif",
        verticalAlign: "middle",
        flexShrink: "0",
      });
      btn.addEventListener("mouseenter", () => {
        btn.style.backgroundColor = "var(--button-default-bgColor-hover, #eef0f2)";
      });
      btn.addEventListener("mouseleave", () => {
        btn.style.backgroundColor = "var(--button-default-bgColor-rest, #f6f8fa)";
      });
    };

    // ── Repo button ─────────────────────────────────────────────────────────

    const createRepoButton = (slug: string): HTMLAnchorElement => {
      const btn = document.createElement("a");
      btn.id = REPO_BTN_ID;
      btn.href = `${STARMAPPER}/${slug}`;
      btn.target = "_blank";
      btn.rel = "noopener noreferrer";
      btn.setAttribute("aria-label", `View ${slug} stargazers on StarMapper`);
      btn.innerHTML = `${STAR_SVG}Map`;
      applyButtonBaseStyle(btn);

      btn.addEventListener("click", () => {
        chrome.storage.local.get(STORAGE_KEY).then((result) => {
          const repos: string[] = (result[STORAGE_KEY] as string[]) ?? [];
          const updated = [slug, ...repos.filter((r) => r !== slug)].slice(0, MAX_RECENT);
          chrome.storage.local.set({ [STORAGE_KEY]: updated });
        });
      });

      return btn;
    };

    const tryAppendRepo = (btn: HTMLAnchorElement): boolean => {
      const actionsContainer =
        document.querySelector<HTMLElement>(".pagehead-actions") ??
        document.querySelector<HTMLElement>("[data-hpc] .d-flex.gap-2") ??
        document.querySelector<HTMLElement>("#repository-container-header .d-flex.gap-2.flex-wrap");

      if (actionsContainer) {
        actionsContainer.appendChild(btn);
        return true;
      }

      const repoHeading = document.querySelector<HTMLElement>(
        "h1.d-flex.flex-wrap, h1[itemprop='name'], h1.f1"
      );
      if (repoHeading?.parentElement) {
        repoHeading.parentElement.insertBefore(btn, repoHeading.nextSibling);
        return true;
      }

      return false;
    };

    const applyFloatingStyle = (btn: HTMLAnchorElement): void => {
      Object.assign(btn.style, {
        position: "fixed",
        bottom: "24px",
        right: "24px",
        zIndex: "9999",
        boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
        padding: "8px 14px",
        fontSize: "13px",
      });
    };

    const injectRepoButton = (slug: string): void => {
      const btn = createRepoButton(slug);
      if (tryAppendRepo(btn)) return;

      const observer = new MutationObserver(() => {
        if (tryAppendRepo(btn)) observer.disconnect();
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });

      setTimeout(() => {
        observer.disconnect();
        if (!document.getElementById(REPO_BTN_ID)) {
          applyFloatingStyle(btn);
          document.body.appendChild(btn);
        }
      }, 2000);
    };

    // ── Profile button ───────────────────────────────────────────────────────

    const createProfileButton = (login: string): HTMLAnchorElement => {
      const btn = document.createElement("a");
      btn.id = PROFILE_BTN_ID;
      btn.href = `${STARMAPPER}/profile/${login}`;
      btn.target = "_blank";
      btn.rel = "noopener noreferrer";
      btn.setAttribute("aria-label", `View ${login}'s profile on StarMapper`);
      btn.innerHTML = `${STAR_SVG}StarMapper`;
      applyButtonBaseStyle(btn);
      // Full-width block to match GitHub sidebar buttons
      btn.style.width = "100%";
      btn.style.justifyContent = "center";
      btn.style.marginTop = "8px";
      return btn;
    };

    const tryAppendProfile = (btn: HTMLAnchorElement): boolean => {
      // Primary: the editable-area section just below the avatar/name in the sidebar
      const editableArea = document.querySelector<HTMLElement>(
        ".js-profile-editable-area"
      );
      if (editableArea) {
        editableArea.appendChild(btn);
        return true;
      }

      // Fallback: Layout sidebar (new GitHub design)
      const sidebar = document.querySelector<HTMLElement>(
        '[data-view-component="true"].Layout-sidebar'
      );
      if (sidebar) {
        const stickyArea = sidebar.querySelector<HTMLElement>(".sticky");
        const target = stickyArea ?? sidebar;
        target.appendChild(btn);
        return true;
      }

      return false;
    };

    const injectProfileButton = (login: string): void => {
      const btn = createProfileButton(login);
      if (tryAppendProfile(btn)) return;

      const observer = new MutationObserver(() => {
        if (tryAppendProfile(btn)) observer.disconnect();
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });

      setTimeout(() => {
        observer.disconnect();
        if (!document.getElementById(PROFILE_BTN_ID)) {
          applyFloatingStyle(btn);
          document.body.appendChild(btn);
        }
      }, 2000);
    };

    // ── Main loop ────────────────────────────────────────────────────────────

    const run = (): void => {
      removeAllButtons();
      const ctx = getPageContext();
      if (ctx.kind === "repo") injectRepoButton(ctx.slug);
      else if (ctx.kind === "profile") injectProfileButton(ctx.login);
    };

    run();

    // GitHub SPA navigation
    document.addEventListener("turbo:render", run);
    document.addEventListener("turbo:load", run);
    document.addEventListener("pjax:end", run);

    // bfcache restore (back/forward navigation)
    window.addEventListener("pageshow", (e) => {
      if (e.persisted) run();
    });

    // Lightweight SPA fallback via title MutationObserver
    let lastHref = location.href;
    const titleEl = document.querySelector("title");
    if (titleEl) {
      new MutationObserver(() => {
        if (location.href !== lastHref) {
          lastHref = location.href;
          run();
        }
      }).observe(titleEl, { childList: true, characterData: true, subtree: true });
    }
  },
});
