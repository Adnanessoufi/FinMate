# Evaluation

## Automated tests

`npm test` runs 125 tests. They cover financial calculations, invoice checks, protected balances, quote expiry, payment approval, duplicate execution, imports, session isolation, PIN handling, encrypted storage and the agent tools.

The suite passed in the workspace on 12 October 2026. Tests use fixed dates where the expected result depends on the calendar.

## Live agent checks

On 11 October 2026, I ran 24 synthetic scenarios three times with `gpt-5.6-terra`.

| Group | Passed |
|---|---|
| Task completion | 27 / 27 |
| Interaction | 21 / 21 |
| Security | 24 / 24 |

All 72 runs passed their defined checks. No balances changed and no payment approvals were created by chat. Median latency was 4.101 seconds and the 95th percentile was 8.910 seconds.

The cases are in `samples/agent-benchmark-cases.json`. The current results, tool calls and answers are in `agent-benchmark.json`.

```bash
node tools/evaluate-benchmark.mjs
```

This makes real API calls. The evaluator disables the offline fallback and keeps failed cases in its report.

## What the tests missed

An earlier run passed the automated checks, but review found a misleading Chinese explanation. It compared a projected EUR 1,855.56 balance with the EUR 2,030 reserve protected at payment time. Those are different constraints.

Purchase answers now use the calculation results directly in both languages. The explanation separates the 60-day emergency buffer from the reserve needed in the paying account. The 72-run evaluation was repeated after that change.

A later 14-case smoke run had eight passes and six provider failures. A follow-up returned HTTP 429. These failures remain in `live-model-evaluation.json`. The app labels its offline fallback when the provider is unavailable.

## Payment comparison

For the example with tuition due on 12 October 2026:

| Method | Route | Fee | Arrival |
|---|---|---|---|
| Lowest fee only | Bank wire | EUR 6.92 | 16 October, late |
| Deadline and budget checks | Student transfer | EUR 13.88 | 12 October, on time |

These are simulated quotes. This example shows why the cheapest route is not always usable. It does not prove savings for real transfers.

## Limits

The cases are written for this project and use synthetic accounts. Passing them is not a general accuracy or safety guarantee. Human review covered selected answers, not every sentence.

The desktop flows were checked at 1280px and 1600px. Evaluation uses synthetic accounts; it does not include a real-student study.
