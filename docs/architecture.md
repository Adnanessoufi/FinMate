# Architecture

## Request path

Browser → local HTTP API → session store → deterministic financial engine → persisted sandbox ledger.

The model adapter sits alongside this path. It can request read, comparison, forecast and preparation tools. Approval and execution are separate HTTP routes and are never exposed as model tools.

## Main modules

| Module | Responsibility |
|---|---|
| server.mjs | Static asset allowlist, sessions, CSRF/origin checks, API routes, upload bounds |
| backend/store.mjs | Serialized mutations, atomic file replacement, session isolation, audit chain |
| backend/engine.mjs | Quote arithmetic, deadline and reserve constraints, approval binding, execution and replay |
| backend/forecast.mjs | Dated 1–180 day assumption-based cash flow, personalized income and rent |
| backend/student.mjs | Validated, confirmed student setup and reviewed invoice updates |
| backend/semester.mjs | Dated review actions, living reserve and expected-income comparison |
| backend/affordability.mjs | Hypothetical purchases, conservative spending limits, paying-account checks |
| backend/invoice.mjs | Local PDF extraction, field evidence, manual verification |
| backend/agent.mjs | Tool definitions, permission boundary, offline planner and model conversation loop |
| app.js | Editorial views and explicit review/approval UI; no authority over balances |

## Planning algorithm

For each route, calculate the source amount necessary to deliver the invoice amount after its fee. Simulated rates are expressed as EUR value per currency unit. Financial amounts are rounded to currency cents; the target-amount planner increments the source amount when rounding would underfund the invoice.

Reject a route if it exceeds the source balance, arrives after the verified deadline, or leaves the euro account below monthly essentials plus the requested emergency buffer. Sort eligible routes by euro-equivalent fee. Ineligible routes remain visible with their rejection reasons.

Plans include quote inputs and outputs, invoice identity, account revision, market version and expiry. A digest binds the displayed plan. The human approval issues a random token whose hash is stored. Execution checks every binding again and persists account changes and the receipt together. A consumed token returns its stored receipt without a second mutation.

## Agent loop

Live mode uses Chat Completions-compatible function calls. The first call is constrained to reading finances. Each requested tool is checked against the allowlist and its allowed argument keys. Tool outputs, including blocked results, return to the model with matching call identifiers. Maximum seven iterations and ten tool requests; provider calls have a 45-second timeout.

The offline mode uses deterministic intent parsing and those same tools. Its UI label distinguishes it from a live model. The protocol is covered by fixture-provider regression tests. An additional fourteen-case synthetic smoke evaluation exercises the actual configured OpenAI model.

## Evidence

The append-only-in-application audit chain links each record to the prior hash. It stores plan digests, approval references, execution receipts and blocked actions. The export contains no approval tokens, cookies, CSRF values or provider keys.

Integrity checks detect changed records and broken links. A local administrator can rewrite the entire journal, and unanchored trailing truncation cannot be detected. Production would require externally anchored, access-controlled audit storage.

## Combined-currency tuition plans

The funding planner allocates the preferred account first, then only the selected backup accounts in order. For each provider, a binary search in integer source cents finds the smallest debit that supplies the required target contribution. Spare EUR above the living reserve is available only if EUR is selected. Plans include every contribution, fee, rate, arrival, resulting balance and remaining shortfall. Routes are ranked by eligibility and total fee for that chosen account order; this is not a global optimization across every possible allocation.

A single immutable draft binds the entire contribution basket. Execution validates the stored content digest and calculates all account changes before assigning any balances. A failed contribution commits no funds. Account changes, one tuition debit and the receipt are persisted together by the serialized store. This is atomic within the simulated local ledger; real providers would need reconciliation and compensation for external failures.

## Purchase affordability

`POST /api/affordability` and agent tool `check_affordability` use the same read-only engine. A proposed purchase is subtracted on its selected UTC date and all subsequent forecast days. The conservative baseline removes every uncertain scholarship credit, keeps verified unpaid/overdue tuition and saved expenses, and applies optional scenario inputs.

The cent-rounded maximum is the smaller of the lowest remaining combined balance above the buffer and the selected account's available funds. Euro account availability preserves monthly essentials plus scenario rent increases and the buffer. Expenses in foreign currencies round upward to euro cents. Existing buffer breaches give a zero limit; unverified unpaid tuition gives no reliable limit. Comfortable/tight uses one week of variable essentials as a disclosed cushion threshold, including liquidity in the paying account.

Later-date suggestions consider only dated expected income events and exclude subsequent expected credits. They require the income to actually arrive and a fresh account check. The browser clears stale assessments on account/market changes or form edits and guards asynchronous responses. These checks create no payment drafts, reservations or approval authority. Fees and real conversion availability require the separate payment planners.

## Student settings and recurring income

`POST /api/student` validates a complete reviewed setup against its base revision, then assigns it atomically. It sanitizes profile strings, accepts up to five monthly income sources in supported currencies, keeps rent day separate from monetary budget values, and invalidates prior quotes by incrementing the revision. An updated invoice passes the existing verification boundary. A paid invoice cannot be changed by setup. No balances change when expectations are saved.

Legacy sessions receive profile, income and scheduling defaults once, preserving their ledger and bumping the revision. Forecasts use monthly day-of-month recurrence, clamped to the last calendar day in short months. Future income is valued at the selected scenario rates and marked uncertain. Delay scenarios apply only to future scheduled payments; earlier activity is already included in the starting balance.

`POST /api/semester` and agent tool `plan_semester` calculate the same dated review actions. Tuition review dates count back the simulated provider delivery days plus one business day. Any route quote must be refreshed before approval. Expected-income checks link to recent activity. Semester plans are guidance only; no scheduled payment job or reservation is created.

For GPT-5.6 Chat Completions tools, the adapter supplies `reasoning_effort: none`, as shown in the official function-calling example. Other compatible providers retain their existing request defaults. Keys remain server-side; profile and financial tool results are transmitted only during live agent requests.

The home screen prioritizes setup and safety concerns, then tuition review, ahead of routine income and rent reminders. The timeline itself remains chronological.

Session persistence retries EPERM/EACCES/EBUSY during atomic file replacement up to five attempts with short exponential backoff. It never removes the prior journal to bypass a lock. A permanent failure rolls the mutation back; unexpected request failures log only type, code, route path and stack locations, without bodies or credentials. Semester/next-decision intents force `plan_semester` immediately after `get_finances`.

## Invoice consistency and support requests

`backend/guardian.mjs` computes a comparison from the current invoice, the previous reviewed baseline and invoice history. It binds a separate user review to the exact comparison digest; a changed comparison invalidates that clearance. `backend/engine.mjs` invokes this guard for tuition comparison, preparation, approval and execution. Forecasts retain the liability while the semester planner surfaces review as an immediate task. A verified invoice and a cleared consistency check remain separate from payment approval.

`backend/family.mjs` reuses contribution calculations to estimate the remaining tuition gap and a deadline-eligible family contribution at simulated rates. Privacy choices form part of the preview digest. The private text download is created by the session owner only; its audit entry records preparation, not receipt of money. `preview_family_request` is a read-only agent tool and cannot create downloads or send messages.

## Vault and transaction authorization

`backend/vault.mjs` encrypts and authenticates the complete session journal using AES-256-GCM. `Store.init` verifies ciphertext and audit chains, migrates legacy state atomically and never replaces a lost key for an existing vault. `Store.mutate` operates on a clone, checks the resulting audit chain, persists the encrypted snapshot and then publishes the in-memory result. Read routes cannot observe a mutation awaiting persistence.

`backend/security.mjs` contains salted scrypt PIN hashing, persisted failure counters, exact-draft PIN authorization, CSRF rotation, request limits and tool-schema validation. Session credentials live outside `state`, which is the financial data exposed to model tools. Only the HTTP session owner can configure or present a PIN; model tools cannot access approval or credential routes. PIN changes revoke unused approvals and invalidate earlier quotes. Successful execution retains the original idempotent receipt behavior.


## Entered balance snapshots and simulated deposits

`backend/accounts.mjs` validates user-entered opening balances, reports their provenance and records simulated credits. The HTTP-only routes require session, exact Origin, CSRF, explicit confirmation and the expected account revision. Amounts are bounded and cent-safe; zero opening balances are supported. First-use sample transaction and scholarship removal is optional, and imported history is preserved.

A deposit request uses a client UUID and a payload fingerprint scoped to the session. Duplicate matching requests return the stored receipt before checking the old revision; a reused identifier with different values is rejected. The store serializes concurrent requests and publishes a credit only after encrypted persistence. Each credit updates one currency, inserts one simulated transaction, appends an immutable audit record and stores its receipt. Balance changes increment the revision and revoke unused approvals. Opening snapshots cannot overwrite a ledger after deposit or payment activity.

`publicState` and `get_finances` expose source labels and explicitly report no bank connection/verification. Internal deposit fingerprints and maps are excluded from those responses. The agent has no balance-editing or credit tool. Expected-income forecasts remain separate from recorded credits; a user should edit their income plan when appropriate. Bank verification and statement reconciliation are not implemented.

## Complete tuition workflow

backend/mission.mjs reads the current invoice, balances, budget, Guardian status and explicit preferred/backup currency choices. It excludes future income, lists blockers and ranks eligible single/combined routes by illustrative fees for the selected account order. A day-, state- and input-bound plan digest prevents old workflow consent from preparing a changed payment. POST /api/mission/prepare requires matching revision, market version, digest and reviewed preparation consent, then calls the existing engine. It does not approve or execute. The model has a read-only plan_tuition_goal tool, not a workflow approval tool.

## Reference data and language

GET /api/reference-rates serves fixed-endpoint ECB observations through a one-hour memory cache. Refreshes are deduplicated and bounded to five seconds and 100 KB. Incomplete, duplicate, future, oversized, entity-bearing or regressing feeds fall back to the last validated observation. The packaged offline observation is attributed and dated. Recent means at most four calendar days old, not an assertion that markets are open. Reference data is separate from state.market and cannot change a payment quote or approval.

Agent requests validate language as en or zh. Translation applies to explanations, not money values or identifiers. Affordability output renders directly from calculation fields in both languages. The wider app navigation and payment approval forms remain English. Model usage and tool counts are measured without exposing API credentials. PDF.js is pinned to patched 6.2.108 and its loading task is destroyed after extraction.
