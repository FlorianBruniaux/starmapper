// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

// Curated seed for the Trending watchlist: popular, actively-starred repos that should
// stay visible in Trending even without organic StarMapper traffic. The refresh-trending
// cron rescans these (plus top scanned repos) on rotation. Keys are lowercase to match
// badge_cache and the star_event join.
//
// Edit this list and re-run `pnpm db:seed:trending-watchlist` to apply (idempotent).

export type WatchlistEntry = { owner: string; repo: string };

export const TRENDING_WATCHLIST_SEED: WatchlistEntry[] = [
  // AI / LLM tooling
  { owner: "ollama", repo: "ollama" },
  { owner: "langchain-ai", repo: "langchain" },
  { owner: "huggingface", repo: "transformers" },
  { owner: "run-llama", repo: "llama_index" },
  { owner: "comfyanonymous", repo: "comfyui" },
  { owner: "danny-avila", repo: "librechat" },
  { owner: "microsoft", repo: "autogen" },
  { owner: "crewaiinc", repo: "crewai" },
  { owner: "openai", repo: "openai-python" },
  { owner: "anthropics", repo: "anthropic-sdk-python" },
  // Frameworks / runtimes
  { owner: "vercel", repo: "next.js" },
  { owner: "facebook", repo: "react" },
  { owner: "vuejs", repo: "core" },
  { owner: "sveltejs", repo: "svelte" },
  { owner: "angular", repo: "angular" },
  { owner: "withastro", repo: "astro" },
  { owner: "remix-run", repo: "remix" },
  { owner: "nodejs", repo: "node" },
  { owner: "denoland", repo: "deno" },
  { owner: "oven-sh", repo: "bun" },
  // Build / dev tooling
  { owner: "vitejs", repo: "vite" },
  { owner: "tailwindlabs", repo: "tailwindcss" },
  { owner: "shadcn-ui", repo: "ui" },
  { owner: "biomejs", repo: "biome" },
  { owner: "microsoft", repo: "playwright" },
  { owner: "microsoft", repo: "vscode" },
  { owner: "t3-oss", repo: "create-t3-app" },
  { owner: "honojs", repo: "hono" },
  { owner: "tauri-apps", repo: "tauri" },
  // Data / backend
  { owner: "prisma", repo: "prisma" },
  { owner: "supabase", repo: "supabase" },
  { owner: "drizzle-team", repo: "drizzle-orm" },
  { owner: "pocketbase", repo: "pocketbase" },
  // Self-hosted / products
  { owner: "n8n-io", repo: "n8n" },
  { owner: "appwrite", repo: "appwrite" },
  { owner: "calcom", repo: "cal.com" },
  { owner: "makeplane", repo: "plane" },
  { owner: "immich-app", repo: "immich" },
  { owner: "coollabsio", repo: "coolify" },
  // Languages
  { owner: "rust-lang", repo: "rust" },
  { owner: "golang", repo: "go" },
  { owner: "ggml-org", repo: "llama.cpp" },
].map((e) => ({ owner: e.owner.toLowerCase(), repo: e.repo.toLowerCase() }));
