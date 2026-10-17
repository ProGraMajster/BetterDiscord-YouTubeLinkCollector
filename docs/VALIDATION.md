# Validation 1.2.7 — 2026-10-17

Author: **ProGraMajster**. Prerelease. Native observations and browser checks below were recorded on 2026-10-16; release validation is repeated on 2026-10-17. Publication follows the exact-commit CI and tag workflow described in [RELEASING.md](RELEASING.md).

| Check | Result | Boundary |
| --- | --- | --- |
| Windows / Node.js 24 | 194/194 PASS; no failures/skips | Existing export/recovery/navigation coverage plus 24+1 cross-channel hits, all-foreign pages, genuine missing hits, excluded-ID validation and repeated same-instance disable/enable. |
| Pre-fix UI lifecycle replay | REPRODUCED | The installed pre-fix revision delivers zero refreshes after disable/enable where one was expected. The repaired scheduler delivers repeated updates over three cycles. |
| Syntax / author / network boundary | PASS | 13 JavaScript files and both inline HTML fixtures. |
| Browser: same-instance re-enable, navigation and TXT | 12/12 PASS | Synthetic three-page/19-link fixture; waits for actual visible UI completion within 5 seconds. |
| Browser: foreign-channel page evidence | 7/7 PASS | Synthetic page 6 with 24+1 hits, then all-foreign page 7; 175 reviewed, 149 selected, 26 excluded; TXT has 149 selected-channel links. |
| Responsive UI / keyboard | PASS | 520×680 viewport, footer visible, no horizontal overflow; four tabs, Home/End; override reset. |
| Real Discord: 24/25 stall | REPRODUCED and corrected | Fresh native shape metadata showed one complete hit from another channel. Same page then qualified 25/25 with 24 selected and one excluded. User confirmed forward page 6→7. |
| Real Discord: frozen UI | REPRODUCED and user-confirmed corrected | Native scan advanced while the old view stayed fixed; timer replay identified cancelled-handle guard. User confirmed live counters/countdown after final installation. Fresh panel diagnostics showed age 0 seconds, no error. |
| Real collection preservation | PASS | Installation at Pause preserved 1168 occurrences / 1167 unique / one duplicate, configuration bytes unchanged; JSON roundtrip verified privately. |
| Full native 97-page run, physical export save, complete channel history | UNVERIFIED | Forward native progress and UI confirmation do not establish these. |

[Tests](TEST-RESULTS-1.2.7.txt), [browser checks](BROWSER-RESULTS-1.2.7.txt), [repair report](RELEASE-REPORT-1.2.7.md), [prior validation](VALIDATION-1.2.6.md).
