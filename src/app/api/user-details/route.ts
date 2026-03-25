import { NextRequest, NextResponse } from "next/server";

export type UserDetail = {
  login: string;
  name: string | null;
  email: string | null;
  bio: string | null;
  company: string | null;
  blog: string | null;
  location: string | null;
  twitter_username: string | null;
  followers: number;
  following: number;
  public_repos: number;
  avatarUrl: string;
};

async function fetchUser(login: string, token: string): Promise<UserDetail | null> {
  try {
    const res = await fetch(`https://api.github.com/users/${encodeURIComponent(login)}`, {
      headers: { Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28" },
    });
    if (!res.ok) return null;
    const u = await res.json();
    return {
      login: u.login,
      name: u.name ?? null,
      email: u.email ?? null,
      bio: u.bio ?? null,
      company: u.company ? u.company.trim().replace(/^@/, "") : null,
      blog: u.blog ?? null,
      location: u.location ?? null,
      twitter_username: u.twitter_username ?? null,
      followers: u.followers ?? 0,
      following: u.following ?? 0,
      public_repos: u.public_repos ?? 0,
      avatarUrl: u.avatar_url ?? "",
    };
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  try {
    const { logins } = await req.json() as { logins: string[] };
    if (!Array.isArray(logins) || logins.length === 0)
      return NextResponse.json({ error: "Missing logins" }, { status: 400 });
    if (logins.length > 200)
      return NextResponse.json({ error: "Max 200 users per request" }, { status: 400 });

    const token = req.headers.get("x-gh-token") || process.env.GITHUB_TOKEN;
    if (!token) return NextResponse.json({ error: "No GitHub token — add your token via the key icon" }, { status: 500 });

    // Fetch with concurrency 10
    const CONCURRENCY = 10;
    const results: UserDetail[] = [];
    for (let i = 0; i < logins.length; i += CONCURRENCY) {
      const batch = logins.slice(i, i + CONCURRENCY);
      const fetched = await Promise.all(batch.map((l) => fetchUser(l, token)));
      results.push(...fetched.filter((u): u is UserDetail => u !== null));
    }

    return NextResponse.json({ users: results });
  } catch (e) {
    console.error("[user-details] Error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
