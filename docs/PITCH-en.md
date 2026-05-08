# StarMapper: full feature recap + what's changed

## What is StarMapper?

Give it a GitHub repo URL, get an interactive map of all its stargazers with their locations, native clustering, and stats by country/city/company. Free, open-source, no account required.
→ https://starmapper.bruniaux.com

---

## Pages available today

- https://starmapper.bruniaux.com : landing page with repo URL input + table of already-mapped repos
- https://starmapper.bruniaux.com/ruvnet/ruflo : map of ruflo's 45k stargazers
- https://starmapper.bruniaux.com/explore : discover devs by username, leaderboard, sticky map

### /profile

- https://starmapper.bruniaux.com/profile/florianbruniaux : my profile, mini-map, stats, repos, nearby devs
- https://starmapper.bruniaux.com/profile/ruvnet : ruvnet's profile, 174 repos, map, languages, top repos

### Other pages

- https://starmapper.bruniaux.com/devs : dev maps filtered by programming language
- https://starmapper.bruniaux.com/devs/atlas : choropleth map, which language dominates by country?
- https://starmapper.bruniaux.com/feed/florianbruniaux : my RSS subscription page
- https://starmapper.bruniaux.com/changelog : version history

---

## What's changed recently

### Developer profiles (0.3.3 → 0.4.2)

The profile page went from "bio + followers" to a full hub. Concrete example with https://starmapper.bruniaux.com/profile/ruvnet:

- **GitHub Repos section**: top repos (ruflo, RuView, RuVector…) with language badges + stars, link to all 174 GitHub repos
- **"Map a repo" button** next to the "174 repos" badge: full repo picker, searchable, sortable by Stars or A–Z. One click and you land on the StarMapper map for that repo (we indexed ruvnet's top 5 tonight: ruflo 45k, RuView 52k, RuVector 4k, agentic-flow 685, Bot-Generator-Bot 565)
- **Refresh**: pulls fresh location, followers, and repos from GitHub, and resets the top repos cache so the next load re-fetches from GitHub
- **Nearby developers**: devs located within Xkm, with pins on the mini-map
- **Contact dropdown**: LinkedIn, email, GitHub, obfuscated against scraping

### RSS subscription system (0.4.0)

Devs can publish short announcements (280 chars max) directly on their profile, authenticated via GitHub PAT. My feed as an example:

- RSS 2.0 → https://starmapper.bruniaux.com/api/feed/florianbruniaux/rss
- JSON Feed 1.1 → https://starmapper.bruniaux.com/api/feed/florianbruniaux/json
- Subscription page → https://starmapper.bruniaux.com/feed/florianbruniaux

1h CDN cache, `If-Modified-Since` / 304 supported. Every RSS hit is tracked in analytics.

### Explore (ongoing)

https://starmapper.bruniaux.com/explore: followers leaderboard (top, power users, nearby), search by `@ruvnet` or `ruvnet` (the `@` prefix was blocking results before, fixed this morning), sticky map in sync with results.

### Organic Score (0.3.4)

A 0–100 score per repo estimating whether stars are organic or farmed, based on 4 public signals:

- Fork / star ratio (30%)
- Watcher / star ratio (5%)
- % zero-follower stargazers (45%)
- Releases cadence (20%)

Displayed in the repo list with a detail modal on click. 92% correct classification on the calibration corpus.

### Language Atlas (0.3.0)

https://starmapper.bruniaux.com/devs/atlas: which language dominates by country, computed from 4M+ devs in DB, refreshed daily.

---

## Stack

Next.js 16 (App Router) + TypeScript + MapLibre GL 5 + Prisma 7 + Neon Postgres + Jawg Maps, deployed on Vercel, sponsored by Neon (100GB plan)
