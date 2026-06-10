# starmapper-mcp

MCP server for [StarMapper](https://starmapper.bruniaux.com). Query GitHub repository audience data directly from Claude Code.

## Install

Add to your Claude Code MCP config (`~/.claude/mcp.json` for global, `.claude/mcp.json` for project):

```json
{
  "mcpServers": {
    "starmapper": {
      "command": "npx",
      "args": ["-y", "starmapper-mcp"]
    }
  }
}
```

Then restart Claude Code. The server auto-downloads on first use.

## Tools

### `get_repo_stats(owner, repo)`
Total stars, geocoding rate, top 10 countries and cities, organic score summary.

### `get_organic_score(owner, repo)`
Score 0-100 with full signal breakdown: fork/star ratio (40%), watcher/star ratio (5%), zero-follower stargazers (55%). Corpus calibration accuracy: 85.7%.

### `get_velocity(owner, repo)`
Per-country star velocity over the last 30 days vs the 31-90 day window. Classifies each country as rising, new, stable, or declining.

### `get_influential_stargazers(owner, repo, min_followers?)`
Stargazers above a follower threshold (500/1000/5000, default 500), sorted by influence. Includes GitHub profile URL.

### `index_repo(owner, repo)`
Triggers a full re-indexation of the repository on StarMapper. Drives the chunk loop, geocodes all stargazers, and saves the result. For large repos this may take several minutes. Set `GITHUB_TOKEN` in the env config to use your own GitHub API quota instead of the shared server quota (strongly recommended for repos with more than 6k stars).

### `health_check()`
Pings the StarMapper API and returns server status and round-trip latency. Useful for verifying connectivity before running heavier tools.

### `get_cache_status(owner, repo)`
Returns cache metadata for a repo: whether it has been scanned, the scan date, mapped count, and total count. Does not transfer the full stargazer blob.

### `get_trending()`
Returns the current list of trending repositories from StarMapper's trending feed, ordered by star velocity (7-day window).

### `list_repos()`
Lists all repositories currently indexed on StarMapper, ordered by last scan date.

### `get_dependents(owner, repo)`
Lists the open-source repos that depend on a given library, sorted by stars. Returns up to 50 dependent repos with star/fork counts, language, and ecosystem. Useful for discovering who uses a library and how prominent those users are. Data is sourced from ecosyste.ms and cached for 7 days. Returns a 404 if the repo hasn't been fetched yet — call the dependents page on StarMapper first to trigger a fetch.

## Example prompts

- "Get stats for vercel/next.js on StarMapper"
- "Is the star base for my repo organic? Run get_organic_score for owner/repo"
- "Which countries started starring owner/repo in the last 30 days?"
- "Who are the most influential people starring owner/repo?"
- "Re-index my repo on StarMapper so the map is up to date"

## Self-hosted / development

Add a GitHub token (read:user scope) to use your own API quota for `index_repo`:

```json
{
  "mcpServers": {
    "starmapper": {
      "command": "npx",
      "args": ["-y", "starmapper-mcp"],
      "env": {
        "GITHUB_TOKEN": "ghp_xxxx"
      }
    }
  }
}
```

Override the base URL for a self-hosted instance:

```json
{
  "mcpServers": {
    "starmapper": {
      "command": "npx",
      "args": ["-y", "starmapper-mcp"],
      "env": {
        "STARMAPPER_BASE_URL": "http://localhost:3000"
      }
    }
  }
}
```

## License

AGPL-3.0-only. See [LICENSE](../LICENSE).
