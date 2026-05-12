export default defineBackground(() => {
  const STARMAPPER = "https://starmapper.bruniaux.com";

  // Mirror the content script blocklist so the context menu doesn't appear
  // on github.com/settings, /explore, etc.
  const SYSTEM_OWNERS = new Set([
    "settings", "notifications", "explore", "trending", "marketplace",
    "features", "pricing", "about", "security", "login", "signup",
    "organizations", "orgs", "apps", "topics", "collections", "events",
    "sponsors", "readme",
  ]);

  chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({
      id: "starmapper-open",
      title: "Open on StarMapper",
      contexts: ["link"],
      documentUrlPatterns: ["https://github.com/*/*"],
      targetUrlPatterns: ["https://github.com/*/*"],
    });
  });

  chrome.contextMenus.onClicked.addListener((info) => {
    if (info.menuItemId !== "starmapper-open" || !info.linkUrl) return;
    try {
      const url = new URL(info.linkUrl);
      if (url.hostname !== "github.com") return;
      const parts = url.pathname.split("/").filter(Boolean);
      if (parts.length < 2) return;
      if (SYSTEM_OWNERS.has(parts[0])) return;
      const slug = `${parts[0]}/${parts[1]}`;
      chrome.tabs.create({ url: `${STARMAPPER}/${slug}` });
    } catch { /* Invalid URL — ignore */ }
  });
});
