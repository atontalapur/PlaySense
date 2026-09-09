# Test fixtures

Recorded from live endpoints on 2026-08-27. Do not regenerate casually —
tests assert against specific counts in these files.

| File | Source |
|---|---|
| `nfl-summary.json` | `site.api.espn.com/.../football/nfl/summary?event=401873298` |
| `mlb-summary.json` | `site.api.espn.com/.../baseball/mlb/summary?event=401816696` |
| `openf1-race-control.json` | `api.openf1.org/v1/race_control?session_key=11353` |

Tests must never hit the network. If a fixture must be re-recorded, update
the asserted counts in the corresponding `.test.js` in the same commit.
