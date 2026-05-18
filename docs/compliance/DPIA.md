# Data Protection Impact Assessment (DPIA)
## StarMapper — Geolocation Processing

**Controller**: Florian Bruniaux, florian@bruniaux.com, France  
**Date**: 2026-05-18  
**Version**: 1.0  
**Status**: Internal — not published on site

---

## 1. Processing Description

StarMapper fetches publicly available data from the GitHub API for any repository a user chooses to scan. For each stargazer, it collects login, display name, self-declared location text, follower count, star date, and account creation date. The location text is geocoded via a 3-tier provider cascade (Jawg, Geoapify, Nominatim) and stored as lat/lng coordinates. Results are displayed as geographic clusters on a map — never as searchable individual records.

**Special categories of data**: none. Location data is not a special category under GDPR Article 9; it is a publicly disclosed free-text field from the user's own GitHub profile.

---

## 2. Necessity and Proportionality

**Purpose**: geographic visualisation of open-source project stargazers.

**Why this data**: lat/lng coordinates are the minimum required to place points on a map. The location text (source) is discarded from the UI after geocoding. The login is retained only to deduplicate across scans and to associate a star event with a geographic point.

**Why public data only**: no scraping, no private API access, no email, no commit history, no private repository data. Every field collected is visible to any unauthenticated GitHub browser session.

**Minimisation applied**:
- Display name and company are stored but not required for map rendering — retained for developer profile pages which serve a distinct discovery use case (opt-in navigation).
- accountCreatedAt is collected only once and used solely as an input signal to an organic integrity heuristic; it is not displayed or searchable.
- Geocoding cache stores location text mapped to coordinates, with no login attached — decoupled from individual identity.

---

## 3. Legitimate Interest Assessment (Three-Part Test)

### 3.1 Legitimate Interest

Providing developers with a free, open-source tool to understand the geographic reach of their own open-source projects. Secondary interest: supporting the broader open-source ecosystem with public data about project adoption patterns (aggregated).

This interest is real, specific, and not overridden by a more specific legal instrument.

### 3.2 Necessity

The processing is necessary to achieve the purpose. Geographic visualisation requires geocoded coordinates; coordinates require location text; location text requires GitHub API access linked to a user login (for deduplication). No less-invasive alternative achieves the same result.

### 3.3 Balancing Test

| Factor | Assessment |
|--------|-----------|
| Nature of data | Public GitHub profile fields; users knowingly set them |
| Reasonable expectation | GitHub users who set a location field can reasonably expect location-aware tools to use it |
| Impact on data subjects | Low: data appears in aggregate clusters, not searchable individual records |
| Opt-out | Available: remove location from GitHub profile; or send deletion request within 30 days |
| Retention limits | github_user and star_event deleted at 12 months; geocache indefinite but not personally identifiable |
| Transparency | Privacy Policy published, linked from every page, CNIL complaint link included |
| Tool nature | Free, open-source, no advertising, no data monetisation |

**Conclusion**: the legitimate interest is not overridden by the rights and freedoms of data subjects.

---

## 4. Clearview AI Mitigations Applied

The CNIL's €20M fine against Clearview AI (2022) targeted: (a) mass collection without a clear legal basis, (b) biometric data, (c) no working opt-out, (d) no response to data subject rights within statutory deadlines.

StarMapper addresses each of these:

| Clearview risk | StarMapper mitigation |
|---------------|----------------------|
| Mass collection without legal basis | API-only access; legitimate interests with published LIA |
| Biometric / sensitive data | None collected |
| No opt-out | Profile removal via GitHub settings (immediate) or deletion request (30 days) |
| No DSAR response | 30-day SLA documented in Privacy Policy; deletion_log retained for 3 years |
| Undisclosed processing | Privacy Policy published; X-Source-Code header on all API responses |

---

## 5. Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| DB breach exposing lat/lng | Low (Neon, AWS us-east-1) | Medium | Coordinates are derived from public data; exposure doesn't reveal non-public location |
| Scraping of geocoded points via /api/geo | Medium | Low | API key auth required; rate limited 60 req/min per IP + 300 req/h per key |
| Data subject unable to exercise rights | Low | Medium | 30-day SLA; deletion_log audit trail |
| Neon data transfer to USA without adequate safeguard | Low | Medium | SCCs in place per Neon DPA |
| GitHub AUP violation | Very low | High | API-only (not scraping per AUP definition); AGPL-3.0 satisfies research/open-access exemption |

---

## 6. Sub-processors

| Provider | Role | Location | Transfer mechanism |
|---------|------|----------|--------------------|
| Neon, Inc. | Postgres database | USA (AWS us-east-1) | SCCs |
| Vercel, Inc. | Hosting + CDN | USA / global edge | SCCs |
| Jawg Maps | Geocoding (primary) | France | EU adequacy |
| Geoapify GmbH | Geocoding (fallback 1) | Germany | EU adequacy |
| Nominatim / OSM Foundation | Geocoding (fallback 2) | UK | UK GDPR + adequacy decision |

---

## 7. DPO / Supervisory Authority

No DPO required (individual operator, no large-scale systematic processing of special-category data).  
Supervisory authority: CNIL — cnil.fr/fr/plaintes

---

## 8. Review Schedule

Review this DPIA when: (a) a new data field is added, (b) a new sub-processor is onboarded, (c) the processing purpose changes, (d) a data subject complaint is received.

Next scheduled review: 2027-05-18.
