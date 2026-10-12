# Evaluation report

Measured on 11 October 2026. **129 automated tests passed, 0 failed** after the workflow, reference-data, bilingual grounding and PDF.js update. These are functional and security regressions for a local financial sandbox, not certification.

## Deterministic coverage

Financial fees and cent rounding, deadline eligibility, protected EUR living funds, explicitly selected backups, atomic combined payments, approval binding and quote expiry, idempotent and concurrent execution, invoice extraction and separate Guardian review, imported transaction duplicates, forecast and affordability uncertainty, profile migration, manual balances and simulated deposits, session isolation, Origin/CSRF checks, strict tool schemas, PIN failure cooldown, encrypted persistence and audit integrity. New workflow cases cover snapshot consent and changes to date, budget, rates, balances and invoice. Reference tests cover invalid/duplicate currency values, future dates, oversized feeds, entities, regressions, caching and offline fallback.

## Actual live-agent evaluation

Model: gpt-5.6-terra. Frozen locally authored dataset: 24 synthetic scenario variants, repeated three times in fresh sessions. Final report: **72 of 72 runs passed their defined automated checks**. Completion: 27/27. Interaction: 21/21. Security: 24/24. Observed balance/approval violations: 0. All accounts, invoices and identifiers are synthetic. No real payment was attempted.

Median latency 4.101 seconds; 95th percentile 8.910 seconds. Measured model calls 204, input tokens 493118, output tokens 20216, tool calls 129. No dollar cost is estimated without verified provider pricing. Tool and token usage is reported separately from success.

Source report: agent-benchmark.json. Dataset: samples/agent-benchmark-cases.json. Reproduce: node tools/evaluate-benchmark.mjs. FINMATE_EVAL_REPEATS defaults to 3 and accepts 1–5. Failures are retained and produce a nonzero exit status. The old fourteen-case functional smoke report is separate.

## Human review and correction

The first expanded run passed its assertions, yet human review found a Chinese explanation comparing a projected EUR 1,855.56 balance incorrectly with the EUR 2,030 payment-time reserve. A correction answer also described an emergency-buffer breach imprecisely. See benchmark-human-review.md and agent-benchmark-before-grounding.json. Affordability conclusions now render directly from engine fields, explaining the distinction between emergency buffer and payment-time reserve. The final report was rerun after this change. Passing assertions must not be described as 100% answer accuracy.

## Controlled baseline

For tuition due 12 October 2026, a fee-only baseline chooses Bank wire at EUR 6.92, arriving 16 October and missing the deadline. Applying FinMate's constraints selects Student transfer at EUR 13.88, arriving 12 October. This is one controlled synthetic counterexample, not evidence of universal fee savings or globally optimal currency allocation.

## Browser verification

An isolated cookie and encrypted journal protect the user's original account. Checks include sample-balance blocking, entered balances, a CNY-only shortfall, explicitly permitted GBP rescue, a 14-day income-delay assumption, changed-plan explanations, exact payment review disabled without PIN, source-dated ECB data and a live grounded Chinese purchase answer. Desktop layout was inspected at 1280 and 1600 pixels. New student-study materials are prepared, but no real participant completion times, testimonials or usability scores have been collected.

## Limits

The dataset is locally authored and assertions are incomplete. Repeated runs measure consistency on these cases, not general accuracy, safety or real-world banking performance. Human review covered selected cases rather than a complete bilingual expert assessment. External transfer fees, delivery, holidays and settlement are simulated. The local prototype is single-process and requires production integrations and jurisdiction-specific review before real financial use.

## Later availability check

After the completed 72-run evaluation, the old fourteen-case smoke suite recorded 8/14 passes and six MODEL_UNAVAILABLE results. A follow-up confirmed HTTP 429. Its failures are retained, not counted as successful live responses. The app now offers a clearly labeled deterministic availability fallback, tested as a separate regression. Live evaluators disable fallback. This does not change or erase the previously measured benchmark.

Clean-copy follow-up on 12 October: a fixed-date offline-agent test had used the wall clock for its tool calculations. The agent now accepts an internal observation clock for deterministic fixture tests, and those tests pass their intended date explicitly. Production calls still use the current time. Git attributes preserve PDF, PowerPoint and image bytes.
