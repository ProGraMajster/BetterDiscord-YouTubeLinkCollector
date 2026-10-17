# Validation 1.2.6 — 2026-10-16

Author: **ProGraMajster**. Local candidate; native observations and synthetic tests are separate.

| Check | Result | Evidence / boundary |
| --- | --- | --- |
| Node.js 24 / Windows | 185/185 PASS; 0 failures/skips | TEST-RESULTS-1.2.6.txt. Includes real plugin start/resume on synthetic page 19 of 50, failure/restart, no duplicate observations, exact-ID recovery, bounded settings, sanitized connection and CLI tests. |
| Syntax / metadata / network boundary | PASS | 13 JavaScript files, two inline HTML fixtures, plugin author/version and no custom Discord transport/token primitives. |
| Browser: error → Resume → Pause → Resume | 12/12 PASS | Synthetic page 19/50 with pages 1–18 already saved. Existing Next only, current-page recapture, persisted automatic mode, Stop and checkpoint. |
| Browser: full collection / export | 11/11 PASS | Synthetic three-page search, all 19 occurrences, complete TXT handed to mocked callback filesystem, no rewind, proper completion state. |
| Real client connection | PASS | Fresh version-1.2.6 response from the native plugin, mounted search/React/pagination, coherent 25/25 and later 23/23 last-page results. Final installed build confirmed again: page 6/6, 23/23, finished, no current error. No native UI control through this channel. |
| Native Pause / Resume | User-confirmed PASS | User confirmed forward navigation and visible work stage; diagnostic response later observed page 6. |
| Native 50-page interruption / friend's exact 24/25 fault | NOT REPRODUCED | Page-19 regression reproduced synthetically. Current client initially resolved 25/25. Do not substitute that for the other computer's failure. |
| Checkpoint/export compatibility | PASS | Schema 1, 1.2.5 checkpoint roundtrip and official-bot compatibility retained. Actual configuration is backed up privately and not overwritten by installation. |
| Native physical export completion / full channel history | UNVERIFIED | Neither a completed search nor a mocked save establishes these. |

[BROWSER-RESULTS-1.2.6.txt](BROWSER-RESULTS-1.2.6.txt), [technical report](RELEASE-REPORT-1.2.6.md), [live connection](LIVE-DIAGNOSTICS.md), [previous 1.2.5 validation](VALIDATION-1.2.5.md).
