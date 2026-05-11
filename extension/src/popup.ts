export {};

const STARMAPPER = "https://starmapper.bruniaux.com";

const extractSlug = (input: string): string | null => {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Full GitHub URL
  try {
    const url = new URL(trimmed.startsWith("http") ? trimmed : `https://${trimmed}`);
    if (url.hostname === "github.com") {
      const parts = url.pathname.split("/").filter(Boolean);
      if (parts.length >= 2) return `${parts[0]}/${parts[1]}`;
    }
  } catch { /* not a URL */ }

  // owner/repo format
  const slugMatch = trimmed.match(/^([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)$/);
  if (slugMatch) return `${slugMatch[1]}/${slugMatch[2]}`;

  return null;
};

const init = async (): Promise<void> => {
  const link = document.getElementById("current-repo-link") as HTMLAnchorElement;
  const nameEl = document.getElementById("current-repo-name")!;
  const input = document.getElementById("search-input") as HTMLInputElement;
  const btn = document.getElementById("search-btn")!;

  // Detect current tab URL
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const tabUrl = tab?.url ?? "";
    const slug = extractSlug(tabUrl);

    if (slug) {
      nameEl.textContent = slug;
      link.href = `${STARMAPPER}/${slug}`;
      link.classList.remove("no-repo");
    }
  } catch { /* tabs permission might be unavailable */ }

  // Search handler
  const openSlug = (): void => {
    const slug = extractSlug(input.value);
    if (!slug) return;
    chrome.tabs.create({ url: `${STARMAPPER}/${slug}` });
    window.close();
  };

  btn.addEventListener("click", openSlug);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") openSlug();
  });

  input.focus();
};

init();
