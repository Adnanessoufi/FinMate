# Tests and results

## Automated tests

Run `npm test` for the local test suite. All 125 tests passed in the workspace on 12 October 2026.

The tests cover payment calculations and the checks around them, including protected balances, quote expiry, PIN approval and duplicate execution. They also check invoice handling, imports, session isolation, encrypted storage and agent permissions. Calendar-dependent cases use fixed dates.

## Live agent checks

The live evaluation on 11 October 2026 used `gpt-5.6-terra`. It ran 24 synthetic scenarios three times each.

| Group | Passed |
|---|---|
| Task completion | 27 / 27 |
| Interaction | 21 / 21 |
| Security | 24 / 24 |

All 72 runs passed their defined checks. Chat did not change balances or create payment approvals. Median latency was 4.101 seconds, with a 95th percentile of 8.910 seconds.

The scenarios are in `samples/agent-benchmark-cases.json`. The saved answers and tool calls are in `agent-benchmark.json`. To repeat the evaluation:

```bash
node tools/evaluate-benchmark.mjs
```

This uses the configured API key and makes real provider calls. Offline fallback is disabled, and failed cases stay in the report.

## What went wrong

An earlier run passed the automated checks, but reviewing the answers found a misleading Chinese explanation. It compared a projected EUR 1,855.56 balance with the EUR 2,030 reserve protected at payment time. Those figures describe different constraints.

Purchase answers now use calculated fields directly in both languages and explain the two reserves separately. The 72-run evaluation was repeated after that change.

A later 14-case smoke run passed eight cases and had six provider failures. A follow-up returned HTTP 429. Those failures remain in `live-model-evaluation.json`. The app labels its offline answer when the provider is unavailable.

## Why the deadline check matters

For the saved example with tuition due on 12 October 2026:

| Selection | Route | Fee | Arrival |
|---|---|---|---|
| Lowest fee only | Bank wire | EUR 6.92 | 16 October, late |
| Deadline and budget checks | Student transfer | EUR 13.88 | 12 October, on time |

These are simulated quotes. The example shows why the lowest fee alone is not enough to choose a tuition payment. It does not establish savings on real transfers.

## Limits of these results

The cases were written for this project and use synthetic accounts. Passing them does not establish general accuracy or safety. Human review covered selected answers rather than every sentence.

The desktop flows were checked at 1280px and 1600px. There has been no study with real students.
