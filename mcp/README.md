# starmapper-mcp

MCP server for [StarMapper](https://starmapper.bruniaux.com) -- query GitHub repository audience data directly from Claude Code.

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
Score 0-100 with full signal breakdown: fork/star ratio (30%), watcher/star ratio (5%), zero-follower % (45%), releases count (20%). Corpus calibration accuracy: 85.7%.

### `get_velocity(owner, repo)`
Per-country star velocity over the last 30 days vs the 31-90 day window. Classifies each country as rising, new, stable, or declining.

### `get_influential_stargazers(owner, repo, min_followers?)`
Stargazers above a follower threshold (500/1000/5000, default 500), sorted by influence. Includes GitHub profile URL.

### `index_repo(owner, repo)`
Triggers a full re-indexation of the repository on StarMapper. Drives the chunk loop, geocodes all stargazers, and saves the result. For large repos this may take several minutes.

## Example prompts

- "Get stats for vercel/next.js on StarMapper"
- "Is the star base for my repo organic? Run get_organic_score for owner/repo"
- "Which countries started starring owner/repo in the last 30 days?"
- "Who are the most influential people starring owner/repo?"
- "Re-index my repo on StarMapper so the map is up to date"

## Self-hosted / development

Override the base URL via env var:

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
