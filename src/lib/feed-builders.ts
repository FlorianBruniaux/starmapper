// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

export type FeedNews = {
  id: number;
  body: string;
  url: string | null;
  publishedAt: Date;
};

type FeedAuthor = {
  login: string;
  name: string | null;
};

/** Escapes a string for safe embedding in XML text nodes. */
export const escapeXml = (s: string): string =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

/**
 * Escapes a string for safe embedding inside a CDATA block.
 * CDATA cannot contain the sequence `]]>` — split it across two CDATA sections.
 */
export const escapeCdata = (s: string): string =>
  s.replace(/]]>/g, "]]]]><![CDATA[>");

/** Builds an RSS 2.0 feed for a developer's news. */
export const buildRss20 = (
  news: FeedNews[],
  author: FeedAuthor,
  feedUrl: string,
  siteUrl: string,
): string => {
  const displayName = author.name ?? author.login;
  const lastBuildDate = news[0]?.publishedAt.toUTCString() ?? new Date().toUTCString();

  const items = news
    .map((n) => {
      const link = n.url ?? `${siteUrl}/profile/${author.login}`;
      return `    <item>
      <title><![CDATA[${escapeCdata(n.body.slice(0, 60))}${n.body.length > 60 ? "…" : ""}]]></title>
      <description><![CDATA[${escapeCdata(n.body)}]]></description>
      <link>${escapeXml(link)}</link>
      <guid isPermaLink="false">starmapper-news-${n.id}</guid>
      <pubDate>${n.publishedAt.toUTCString()}</pubDate>
    </item>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(displayName)} on StarMapper</title>
    <link>${escapeXml(siteUrl)}/profile/${escapeXml(author.login)}</link>
    <description>Announcements from ${escapeXml(displayName)} on StarMapper</description>
    <language>en</language>
    <lastBuildDate>${lastBuildDate}</lastBuildDate>
    <atom:link href="${escapeXml(feedUrl)}" rel="self" type="application/rss+xml"/>
${items}
  </channel>
</rss>`;
};

/** Builds a JSON Feed 1.1 for a developer's news. */
export const buildJsonFeed = (
  news: FeedNews[],
  author: FeedAuthor,
  feedUrl: string,
  siteUrl: string,
): object => {
  const displayName = author.name ?? author.login;

  return {
    version: "https://jsonfeed.org/version/1.1",
    title: `${displayName} — StarMapper News`,
    home_page_url: `${siteUrl}/profile/${author.login}`,
    feed_url: feedUrl,
    description: `Announcements from ${displayName} on StarMapper`,
    author: { name: displayName, url: `${siteUrl}/profile/${author.login}` },
    items: news.map((n) => ({
      id: `starmapper-news-${n.id}`,
      content_text: n.body,
      url: n.url ?? `${siteUrl}/profile/${author.login}`,
      date_published: n.publishedAt.toISOString(),
    })),
  };
};
