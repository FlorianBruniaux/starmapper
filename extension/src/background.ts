export {};  // ES module scope

const STARMAPPER = "https://starmapper.bruniaux.com";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "starmapper-open",
    title: "Open on StarMapper",
    contexts: ["link"],
    // Only show on github.com repo links
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
    const slug = `${parts[0]}/${parts[1]}`;
    chrome.tabs.create({ url: `${STARMAPPER}/${slug}` });
  } catch {
    // Invalid URL — ignore
  }
});
