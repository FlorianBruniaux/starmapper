const STARMAPPER = "https://starmapper.bruniaux.com";
const STORAGE_KEY = "recentRepos";
const MAX_RECENT = 5;

const extractSlug = (input: string): string | null => {
  const trimmed = input.trim();
  if (!trimmed) return null;

  try {
    const url = new URL(trimmed.startsWith("http") ? trimmed : `https://${trimmed}`);
    if (url.hostname === "github.com") {
      const parts = url.pathname.split("/").filter(Boolean);
      if (parts.length >= 2) return `${parts[0]}/${parts[1]}`;
    }
  } catch { /* not a URL */ }

  const slugMatch = trimmed.match(/^([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)$/);
  if (slugMatch) return `${slugMatch[1]}/${slugMatch[2]}`;

  return null;
};

const getRecentRepos = async (): Promise<string[]> => {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  return (result[STORAGE_KEY] as string[]) ?? [];
};

const addRecentRepo = async (slug: string): Promise<void> => {
  const repos = await getRecentRepos();
  const updated = [slug, ...repos.filter((r) => r !== slug)].slice(0, MAX_RECENT);
  await chrome.storage.local.set({ [STORAGE_KEY]: updated });
};

const openRepo = (slug: string): void => {
  chrome.tabs.create({ url: `${STARMAPPER}/${slug}` });
  addRecentRepo(slug);
  window.close();
};

const renderRecentRepos = async (): Promise<void> => {
  const repos = await getRecentRepos();
  if (repos.length === 0) return;

  const section = document.getElementById("recent-section")!;
  const list = document.getElementById("recent-list")!;
  section.style.display = "block";

  list.innerHTML = repos
    .map(
      (repo) => `
      <a class="recent-item" href="${STARMAPPER}/${repo}" target="_blank" rel="noopener noreferrer" data-slug="${repo}">
        <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
          <path d="M8 .25a.75.75 0 01.673.418l1.882 3.815 4.21.612a.75.75 0 01.416 1.279l-3.046 2.97.719 4.192a.75.75 0 01-1.088.791L8 12.347l-3.766 1.98a.75.75 0 01-1.088-.79l.72-4.194L.818 6.374a.75.75 0 01.416-1.28l4.21-.611L7.327.668A.75.75 0 018 .25z"/>
        </svg>
        <span>${repo}</span>
      </a>`
    )
    .join("");

  list.querySelectorAll<HTMLAnchorElement>(".recent-item").forEach((a) => {
    a.addEventListener("click", (e) => {
      e.preventDefault();
      openRepo(a.dataset.slug!);
    });
  });
};

const init = async (): Promise<void> => {
  const link = document.getElementById("current-repo-link") as HTMLAnchorElement;
  const nameEl = document.getElementById("current-repo-name")!;
  const input = document.getElementById("search-input") as HTMLInputElement;
  const btn = document.getElementById("search-btn")!;

  // Detect current tab
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const slug = extractSlug(tab?.url ?? "");
    if (slug) {
      nameEl.textContent = slug;
      link.href = `${STARMAPPER}/${slug}`;
      link.classList.remove("no-repo");
      link.addEventListener("click", (e) => {
        e.preventDefault();
        openRepo(slug);
      });
    }
  } catch { /* tabs permission might be unavailable */ }

  await renderRecentRepos();

  const openFromSearch = (): void => {
    const slug = extractSlug(input.value);
    if (!slug) return;
    openRepo(slug);
  };

  btn.addEventListener("click", openFromSearch);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") openFromSearch();
  });

  input.focus();
};

init();
