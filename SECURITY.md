# Security Policy

## Supported Versions

Only the latest production deployment at **starmapper.bruniaux.com** receives security fixes. There are no versioned releases with independent support windows — the main branch is always the live version.

## Reporting a Vulnerability

**Do not open a public GitHub issue.** Security reports should be submitted privately so a fix can be prepared before public disclosure.

**Preferred channel:** [GitHub Security Advisories](../../security/advisories/new) — click "Report a vulnerability".

**Alternative:** email `florian@bruniaux.com` with subject `[SECURITY] StarMapper — brief description`.

Include in your report:
- Description of the vulnerability and affected component
- Step-by-step reproduction (curl command, screenshot, or minimal script)
- Potential impact (what an attacker could do)
- Your suggested fix, if any (optional but appreciated)

## Response Timeline

| Stage | Target |
|-------|--------|
| Acknowledgement | Within 72 hours |
| Triage (severity + scope) | Within 7 days |
| Fix for CRITICAL/HIGH | Within 14 days |
| Fix for MEDIUM | Within 60 days |
| Public disclosure | After fix ships, or after 90 days maximum |

If a 90-day deadline passes without a fix, you are free to disclose publicly.

## Scope

**In scope:**
- The StarMapper web application at `starmapper.bruniaux.com`
- API routes under `/api/` (authentication, rate limiting, data access)
- Admin endpoints (unauthorized access, privilege escalation)
- XSS, SSRF, SQL injection, secret exposure in server-side code
- The GeoJSON API (`/api/geo/`) and its API key authentication

**Out of scope:**
- GitHub infrastructure, Vercel, Neon, Jawg, Geoapify, Nominatim (report to their respective security teams)
- Denial-of-service via high GitHub star counts (architectural limit, known, not a bug)
- Findings from automated scanners with no proof of exploitability
- Social engineering attacks

## Disclosure Policy

StarMapper follows **coordinated disclosure** (also called responsible disclosure). Researchers who report valid vulnerabilities will be credited in the release notes with their name/handle if they wish.

There is no bug bounty programme at this time.

## Thank You

Security research keeps open-source software trustworthy. Every valid report is taken seriously, regardless of severity, and will receive a personal response.
