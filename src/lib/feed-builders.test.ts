// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { describe, it, expect } from "vitest";
import {
  escapeXml,
  escapeCdata,
  buildRss20,
  buildJsonFeed,
  type FeedNews,
} from "@/lib/feed-builders";

const makeNews = (overrides: Partial<FeedNews> = {}): FeedNews => ({
  id: 1,
  body: "Hello world",
  url: null,
  publishedAt: new Date("2026-01-01T00:00:00Z"),
  ...overrides,
});

const AUTHOR = { login: "octocat", name: "The Octocat" };
const FEED_URL = "https://starmapper.bruniaux.com/api/feed/octocat/rss";
const SITE_URL = "https://starmapper.bruniaux.com";

// ── escapeXml ────────────────────────────────────────────────────────────────

describe("escapeXml()", () => {
  it("escapes & to &amp;", () => {
    expect(escapeXml("AT&T")).toBe("AT&amp;T");
  });

  it("escapes < to &lt;", () => {
    expect(escapeXml("a<b")).toBe("a&lt;b");
  });

  it("escapes > to &gt;", () => {
    expect(escapeXml("a>b")).toBe("a&gt;b");
  });

  it('escapes " to &quot;', () => {
    expect(escapeXml('say "hi"')).toBe("say &quot;hi&quot;");
  });

  it("escapes ' to &apos;", () => {
    expect(escapeXml("it's")).toBe("it&apos;s");
  });

  it("leaves plain text untouched", () => {
    expect(escapeXml("hello world")).toBe("hello world");
  });

  it("escapes multiple characters in one string", () => {
    expect(escapeXml("<a href='x'>")).toBe("&lt;a href=&apos;x&apos;&gt;");
  });
});

// ── escapeCdata ──────────────────────────────────────────────────────────────

describe("escapeCdata()", () => {
  it("leaves text without ]]> unchanged", () => {
    expect(escapeCdata("hello <world>")).toBe("hello <world>");
  });

  it("splits ]]> into two CDATA sections", () => {
    expect(escapeCdata("foo]]>bar")).toBe("foo]]]]><![CDATA[>bar");
  });
});

// ── buildRss20 ───────────────────────────────────────────────────────────────

describe("buildRss20()", () => {
  it("returns a string starting with an XML declaration", () => {
    const xml = buildRss20([], AUTHOR, FEED_URL, SITE_URL);
    expect(xml).toMatch(/^<\?xml version="1\.0"/);
  });

  it("includes the author display name in the channel title", () => {
    const xml = buildRss20([], AUTHOR, FEED_URL, SITE_URL);
    expect(xml).toContain("The Octocat");
  });

  it("uses login as display name when name is null", () => {
    const xml = buildRss20([], { login: "octocat", name: null }, FEED_URL, SITE_URL);
    expect(xml).toContain("octocat");
    expect(xml).not.toContain("null");
  });

  it("includes one <item> per news entry", () => {
    const news = [makeNews({ id: 1 }), makeNews({ id: 2, body: "Second post" })];
    const xml = buildRss20(news, AUTHOR, FEED_URL, SITE_URL);
    expect((xml.match(/<item>/g) ?? []).length).toBe(2);
  });

  it("truncates body to 60 chars with ellipsis in <title>", () => {
    const long = "A".repeat(80);
    const xml = buildRss20([makeNews({ body: long })], AUTHOR, FEED_URL, SITE_URL);
    expect(xml).toContain("…]]></title>");
  });

  it("does not add ellipsis when body fits in 60 chars", () => {
    const xml = buildRss20([makeNews({ body: "Short" })], AUTHOR, FEED_URL, SITE_URL);
    expect(xml).not.toContain("…");
  });

  it("uses news url in <link> when provided", () => {
    const xml = buildRss20(
      [makeNews({ url: "https://example.com/post" })],
      AUTHOR,
      FEED_URL,
      SITE_URL,
    );
    expect(xml).toContain("https://example.com/post");
  });

  it("falls back to profile URL in <link> when url is null", () => {
    const xml = buildRss20([makeNews({ url: null })], AUTHOR, FEED_URL, SITE_URL);
    expect(xml).toContain(`${SITE_URL}/profile/octocat`);
  });

  it("uses the first item's date as lastBuildDate when news array is non-empty", () => {
    const news = [makeNews({ publishedAt: new Date("2026-03-01T12:00:00Z") })];
    const xml = buildRss20(news, AUTHOR, FEED_URL, SITE_URL);
    expect(xml).toContain("01 Mar 2026 12:00:00 GMT");
  });

  it("includes atom:link pointing to feedUrl", () => {
    const xml = buildRss20([], AUTHOR, FEED_URL, SITE_URL);
    expect(xml).toContain(FEED_URL);
  });
});

// ── buildJsonFeed ────────────────────────────────────────────────────────────

describe("buildJsonFeed()", () => {
  it("returns an object with JSON Feed version 1.1", () => {
    const feed = buildJsonFeed([], AUTHOR, FEED_URL, SITE_URL) as Record<string, unknown>;
    expect(feed.version).toBe("https://jsonfeed.org/version/1.1");
  });

  it("uses author name in title", () => {
    const feed = buildJsonFeed([], AUTHOR, FEED_URL, SITE_URL) as Record<string, unknown>;
    expect(feed.title as string).toContain("The Octocat");
  });

  it("uses login as display name when name is null", () => {
    const feed = buildJsonFeed(
      [],
      { login: "octocat", name: null },
      FEED_URL,
      SITE_URL,
    ) as Record<string, unknown>;
    expect(feed.title as string).toContain("octocat");
  });

  it("includes one item per news entry", () => {
    const news = [makeNews({ id: 1 }), makeNews({ id: 2 })];
    const feed = buildJsonFeed(news, AUTHOR, FEED_URL, SITE_URL) as { items: unknown[] };
    expect(feed.items).toHaveLength(2);
  });

  it("item uses news url when provided", () => {
    const news = [makeNews({ url: "https://example.com/post" })];
    const feed = buildJsonFeed(news, AUTHOR, FEED_URL, SITE_URL) as { items: { url: string }[] };
    expect(feed.items[0].url).toBe("https://example.com/post");
  });

  it("item falls back to profile URL when url is null", () => {
    const news = [makeNews({ url: null })];
    const feed = buildJsonFeed(news, AUTHOR, FEED_URL, SITE_URL) as { items: { url: string }[] };
    expect(feed.items[0].url).toBe(`${SITE_URL}/profile/octocat`);
  });

  it("item id follows starmapper-news-{id} format", () => {
    const news = [makeNews({ id: 42 })];
    const feed = buildJsonFeed(news, AUTHOR, FEED_URL, SITE_URL) as { items: { id: string }[] };
    expect(feed.items[0].id).toBe("starmapper-news-42");
  });

  it("sets feed_url and home_page_url", () => {
    const feed = buildJsonFeed([], AUTHOR, FEED_URL, SITE_URL) as Record<string, string>;
    expect(feed.feed_url).toBe(FEED_URL);
    expect(feed.home_page_url).toBe(`${SITE_URL}/profile/octocat`);
  });
});
