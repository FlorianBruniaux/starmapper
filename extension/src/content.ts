export {};  // treat as ES module — avoids global-scope redeclaration collisions

const STARMAPPER = "https://starmapper.bruniaux.com";
const BTN_ID = "starmapper-map-btn";

// Paths that look like /owner/repo but are GitHub system pages
const SYSTEM_OWNERS = new Set([
  "settings", "notifications", "explore", "trending", "marketplace",
  "features", "pricing", "about", "security", "login", "signup",
  "organizations", "orgs", "apps", "topics", "collections", "events",
  "sponsors", "readme",
]);

const getRepoSlug = (): string | null => {
  if (location.hostname !== "github.com") return null;
  const parts = location.pathname.split("/").filter(Boolean);
  if (parts.length !== 2) return null;
  if (SYSTEM_OWNERS.has(parts[0])) return null;
  return `${parts[0]}/${parts[1]}`;
};

const removeButton = (): void => {
  document.getElementById(BTN_ID)?.remove();
};

const injectButton = (slug: string): void => {
  removeButton();

  const btn = document.createElement("a");
  btn.id = BTN_ID;
  btn.href = `${STARMAPPER}/${slug}`;
  btn.target = "_blank";
  btn.rel = "noopener noreferrer";
  btn.setAttribute("aria-label", `View ${slug} on StarMapper`);

  // Matches GitHub's secondary button style (works for both light and dark)
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

  btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" style="flex-shrink:0">
    <path d="M8 .25a.75.75 0 01.673.418l1.882 3.815 4.21.612a.75.75 0 01.416 1.279l-3.046 2.97.719 4.192a.75.75 0 01-1.088.791L8 12.347l-3.766 1.98a.75.75 0 01-1.088-.79l.72-4.194L.818 6.374a.75.75 0 01.416-1.28l4.21-.611L7.327.668A.75.75 0 018 .25z"/>
  </svg>Map`;

  btn.addEventListener("mouseenter", () => {
    btn.style.backgroundColor = "var(--button-default-bgColor-hover, #eef0f2)";
  });
  btn.addEventListener("mouseleave", () => {
    btn.style.backgroundColor = "var(--button-default-bgColor-rest, #f6f8fa)";
  });

  // Injection priority:
  // 1. flex container next to Watch/Star/Fork buttons
  // 2. After the repo title heading
  // 3. Floating fallback (fixed, bottom-right)

  const actionsContainer =
    document.querySelector<HTMLElement>(".pagehead-actions") ??
    document.querySelector<HTMLElement>("[data-hpc] .d-flex.gap-2") ??
    document.querySelector<HTMLElement>("#repository-container-header .d-flex.gap-2.flex-wrap");

  if (actionsContainer) {
    actionsContainer.appendChild(btn);
    return;
  }

  // Fallback: after the h1 repo name in the header
  const repoHeading = document.querySelector<HTMLElement>(
    "h1.d-flex.flex-wrap, h1[itemprop='name'], h1.f1"
  );
  if (repoHeading?.parentElement) {
    repoHeading.parentElement.insertBefore(btn, repoHeading.nextSibling);
    return;
  }

  // Last resort: floating badge
  Object.assign(btn.style, {
    position: "fixed",
    bottom: "24px",
    right: "24px",
    zIndex: "9999",
    boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
    padding: "8px 14px",
    fontSize: "13px",
  });
  document.body.appendChild(btn);
};

const run = (): void => {
  const slug = getRepoSlug();
  if (slug) {
    // Wait for GitHub's React render to settle before injecting
    setTimeout(() => injectButton(slug), 120);
  } else {
    removeButton();
  }
};

// Initial run
run();

// GitHub uses Turbo for SPA navigation
document.addEventListener("turbo:render", run);
document.addEventListener("turbo:load", run);
// Older pjax fallback
document.addEventListener("pjax:end", run);

// Observe title changes as a lightweight SPA nav signal
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
