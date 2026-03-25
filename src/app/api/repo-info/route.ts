import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const owner = searchParams.get("owner");
  const repo = searchParams.get("repo");
  if (!owner || !repo) return NextResponse.json({ error: "Missing params" }, { status: 400 });

  const repoNameRe = /^[a-zA-Z0-9._-]{1,100}$/;
  if (!repoNameRe.test(owner) || !repoNameRe.test(repo)) {
    return NextResponse.json({ error: "Invalid owner/repo format" }, { status: 400 });
  }

  const token = req.headers.get("x-gh-token") || process.env.GITHUB_TOKEN;
  try {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
      headers: {
        Accept: "application/vnd.github.v3+json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      next: { revalidate: 300 },
    });
    if (!res.ok) return NextResponse.json({ error: "Repo not found" }, { status: 404 });
    const data = await res.json();
    return NextResponse.json({
      name: data.full_name,
      description: data.description,
      stars: data.stargazers_count,
      language: data.language,
      avatar: data.owner?.avatar_url,
    });
  } catch {
    return NextResponse.json({ error: "Failed to reach GitHub" }, { status: 502 });
  }
}
