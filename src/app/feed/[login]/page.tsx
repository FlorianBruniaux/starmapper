// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { isValidLogin, normalizeLogin } from "@/lib/github-auth";
import { Header } from "@/components/header";
import { FeedPageClient } from "@/app/feed/[login]/page.client";

type Props = { params: Promise<{ login: string }> };

export const revalidate = 3600;

export const generateMetadata = async ({ params }: Props): Promise<Metadata> => {
  const { login: rawLogin } = await params;
  if (!isValidLogin(rawLogin)) return {};
  const login = normalizeLogin(rawLogin);
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://starmapper.bruniaux.com";
  const user = await prisma.gitHubUser.findUnique({ where: { login }, select: { name: true } });
  const displayName = user?.name ?? login;
  const title = `${displayName} announcements | StarMapper`;
  const description = `Subscribe to ${displayName}'s project announcements via RSS or JSON Feed on StarMapper.`;
  const url = `${appUrl}/feed/${login}`;
  return {
    title,
    description,
    alternates: { canonical: `/feed/${login}` },
    openGraph: {
      title,
      description,
      url,
      siteName: "StarMapper",
      type: "website",
      images: [`https://github.com/${login}.png`],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [`https://github.com/${login}.png`],
    },
  };
};

const FeedPage = async ({ params }: Props) => {
  const { login: rawLogin } = await params;
  if (!isValidLogin(rawLogin)) notFound();
  const login = normalizeLogin(rawLogin);

  const [user, news] = await Promise.all([
    prisma.gitHubUser.findUnique({
      where: { login },
      select: { login: true, name: true },
    }),
    prisma.news.findMany({
      where: { authorLogin: login, deletedAt: null },
      orderBy: { publishedAt: "desc" },
      take: 20,
      select: { id: true, body: true, url: true, publishedAt: true },
    }),
  ]);

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://starmapper.bruniaux.com";
  const rssUrl = `${appUrl}/api/feed/${login}/rss`;
  const jsonUrl = `${appUrl}/api/feed/${login}/json`;
  const displayName = user?.name ?? user?.login ?? login;
  const avatarUrl = `https://github.com/${login}.png`;

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <Header
        sticky
        showNav
        afterLogo={
          <>
            <span className="text-border-subtle shrink-0 select-none" aria-hidden="true">/</span>
            <span className="text-muted text-sm truncate max-w-48">{login}</span>
            <span className="hidden sm:inline-flex items-center text-xs text-muted bg-surface border border-border rounded-full px-2 py-0.5 ml-1">
              announcements
            </span>
          </>
        }
      />

      <main id="main" className="w-full max-w-5xl mx-auto px-4 py-10 pb-16 space-y-8">
        {/* Identity hero */}
        <div className="flex items-start gap-4">
          <Image
            src={avatarUrl}
            alt={`${displayName} avatar`}
            width={72}
            height={72}
            className="rounded-full border-2 border-border shrink-0"
            unoptimized
          />
          <div className="min-w-0 pt-1">
            <h1 className="text-xl font-bold text-foreground leading-tight truncate">{displayName}</h1>
            <p className="text-sm text-muted mt-0.5">@{login}</p>
            <p className="text-sm text-muted mt-2 leading-relaxed">
              Project announcements via StarMapper
            </p>
          </div>
        </div>

        {/* Subscribe card */}
        <FeedPageClient login={login} rssUrl={rssUrl} jsonUrl={jsonUrl} />

        {/* News list */}
        <section className="space-y-4">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-foreground">Latest announcements</h2>
            {news.length > 0 && (
              <span className="text-xs text-muted bg-surface border border-border rounded-full px-2 py-0.5">
                {news.length}
              </span>
            )}
          </div>

          {news.length === 0 ? (
            <div className="rounded-xl border border-border bg-surface/50 px-6 py-10 flex flex-col items-center gap-3 text-center">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" className="text-muted opacity-40" aria-hidden="true">
                <path d="M18 20V10M12 20V4M6 20v-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <p className="text-sm text-muted">No announcements yet.</p>
              <p className="text-xs text-muted max-w-xs">
                Once {displayName} publishes, entries will appear here and in the RSS feed.
              </p>
            </div>
          ) : (
            <ul className="space-y-3">
              {news.map((item) => (
                <li key={item.id} className="rounded-xl bg-surface border border-border p-4 space-y-3">
                  <p className="text-sm text-foreground leading-relaxed">{item.body}</p>
                  <div className="flex items-center gap-3 pt-1 border-t border-border-subtle">
                    <div className="flex items-center gap-1.5">
                      <Image
                        src={avatarUrl}
                        alt=""
                        width={16}
                        height={16}
                        className="rounded-full opacity-70"
                        unoptimized
                      />
                      <span className="text-xs text-muted">{login}</span>
                    </div>
                    <time
                      className="text-xs text-muted ml-auto"
                      dateTime={item.publishedAt.toISOString()}
                    >
                      {item.publishedAt.toLocaleDateString("en-US", {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                      })}
                    </time>
                    {item.url && (
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-accent-blue hover:underline shrink-0"
                      >
                        View →
                      </a>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Footer */}
        <footer className="text-xs text-muted pt-4 border-t border-border">
          <Link
            href={`/profile/${login}`}
            className="hover:text-accent-blue transition-colors"
          >
            View {displayName}&apos;s map on StarMapper →
          </Link>
        </footer>
      </main>
    </div>
  );
};

export default FeedPage;
