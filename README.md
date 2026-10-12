# FinMate

Repository: https://github.com/Adnanessoufi/FinMate

An editorial financial workspace for international students, with a server-backed sandbox, constrained tuition planner, invoice extraction, cash-flow scenarios and a tool-calling agent integration.

## Run

Requires Node.js 22.18 or later.

```powershell
npm ci --ignore-scripts
npm run dev
```

Open http://127.0.0.1:5187. The server binds to your local computer only.

The lockfile pins PDF.js 6.2.108, the patched dependency used for local text extraction. The app has no build step. Use npm ci on a fresh checkout. The optional FINMATE_PDFJS_PATH is a development fallback only, and is not required for installation.

## Enable the live agent

Add these settings to `.env`, using the safe .env.example template:

```dotenv
OPENAI_API_KEY=your-provider-key
FINMATE_MODEL=gpt-5.6-terra
```

Restart the server. The interface displays **Live model** only when a model and provider configuration are present. This workspace is now configured with OpenAI credentials and `gpt-5.6-terra`. Live tool calls were exercised against synthetic accounts; see `docs/live-model-evaluation.json`. Without provider configuration, the app uses the clearly labeled Offline planner.

An OpenAI-compatible provider or local tool-capable model is also supported:

```dotenv
FINMATE_BASE_URL=http://127.0.0.1:11434/v1
FINMATE_MODEL=your-tool-capable-model
FINMATE_API_KEY=your-key-if-required
```

The model name is configurable. Verify availability in your provider account. Keys stay in the server environment and are not served to the browser. In live mode, chat messages and financial tool results are sent to the configured provider. PDF/TXT extraction remains local and raw document text is not sent to the model.

The tool loop follows [official OpenAI function-calling documentation](https://developers.openai.com/api/docs/guides/function-calling). It preserves assistant tool-call messages and returns results using matching `tool_call_id` values. It has bounded iterations, call limits and 45-second provider timeouts. GPT-5.6 Chat Completions tool calls use `reasoning_effort: none`, following the official example.

## Features

- **Tuition:** compares three simulated routes using total fee, business-day arrival, source funds, and the euro living-cost reserve. A cheap late route cannot be approved. Choose EUR, GBP or CNY as the source.
- **Funding-gap rescue:** combine the preferred currency with selected backups when one account cannot cover tuition. Euro reserves are protected, every contribution and fee is displayed, and one approval executes all contributions and tuition together. Unselected accounts are never used.
- **Tuition Guardian:** compares each invoice against previously reviewed recipient, account, amount and currency; flags reused references. Changed details require a separate, digest-bound review with an independent-check method and note before route comparison or payment preparation. Paid references cannot be cleared for reuse. It is a consistency check, not document authentication.
- **Family funding request:** calculates additional tuition funding using only selected contribution accounts, protects euro reserves, and includes estimated family conversion fees and arrival dates. Privacy controls choose whether to include name, university, tuition total and own contribution. An exact reviewed preview becomes a session-private text download; no messages are sent or funds moved. The agent can calculate an estimate but cannot create or send the request.
- **Invoice:** extracts labeled fields from text-based PDFs, TXT files or pasted text. Missing fields require correction. The student verifies recipient, account, reference, amount, currency and deadline before planning. Scanned documents require transcription.
- **Payment PIN:** every HTTP payment approval requires a 6–12 digit PIN plus exact-plan confirmation. PINs use salted scrypt hashes, are excluded from model tools and exports, and lock for five minutes after five incorrect attempts. PIN changes rotate CSRF and revoke pending approvals. Set or change the PIN under your profile → Security settings.
- **Encrypted vault:** saved sessions use AES-256-GCM authenticated encryption. Legacy plaintext sessions migrate atomically; wrong/missing keys, damaged ciphertext or broken audit chains fail closed. A local development key is generated separately from the vault and excluded from source packages.
- **Request protection:** rate limits, bounded agent concurrency, strict JSON shapes and tool schemas, cross-site request rejection, constant-time CSRF checks and browser security headers. Credential-looking PIN/API-key text is rejected before model calls.
- **Approvals:** a server-issued immutable draft includes the exact quote, invoice, account revision and two-minute expiry. Approval is bound to its digest. Execution requires a matching server-issued approval token.
- **Reliable execution:** all account mutations are serialized and persisted. Repeated execution returns the same receipt. Changed accounts, budgets, invoices, rates or expired quotes require a newly reviewed draft.
- **Can I afford this?:** check a purchase in EUR, GBP or CNY on any date within 60 days. See a before/after forecast, comfortable/tight/shortfall verdict, conservative limit and conditional later-date suggestion. Expected income is excluded until it arrives; the selected account and protected euro reserve are checked. No money is reserved or moved. Available through Money Plan and the assistant.
- **Student setup:** a three-step review of name, university, cities, preferred funding currency, semester dates, euro budget, rent day, up to five monthly income sources and tuition details. Saving settings never credits balances or approves a payment. Changed invoices require verification; paid invoices stay intact.
- **Semester plan:** dated rent, expected-income checks, tuition review dates and funding concerns through the saved semester end (up to 180 days). The home screen leads with the next decision. Compare lowest projected balances with and without expected income.
- **Money plan:** edit monthly essentials and the emergency buffer. Explore yuan depreciation, scholarship delays and rent increases. The 60-day projection lists its assumptions and dated events.
- **Agent:** reads finances, compares routes, calculates scenarios and prepares plans through tools. It has no tool for approving, executing, changing budgets or resetting accounts. Offline mode invokes the same financial tools with deterministic intent parsing; it is not an LLM.
- **Activity:** transactions, timestamped decisions, blocked actions, approvals and receipts. An integrity check verifies the audit hash chain. Export JSON execution evidence.
- **Sandbox studio:** move tuition to tomorrow, change a demo exchange rate, expire a quote, and reset only your session.
- **CSV import:** validates fields and currencies, handles quoted fields, rejects duplicates, and adds transactions without altering simulated balances.

## Demo

See [the demo walkthrough](docs/demo.md). Sample invoice files are in `samples/`. Use Activity → Export execution evidence after running the payment flow.

## Verify

```powershell
npm test
```

129 tests pass, covering financial calculations, constraints, approval validation, expiry and rate changes, idempotency, concurrent execution, session isolation, CSRF/origin checks, PDF/CSV extraction, forecast scenarios, audit integrity and the model tool loop with a fixture provider. The expanded live evaluation passed 72 bounded runs. A subsequent fourteen-case smoke run recorded eight passes and six provider availability failures, including HTTP 429; those failures are retained. These are synthetic evaluations, not a statistical benchmark.

See `docs/evaluation.md`, `docs/architecture.md`, and `docs/security.md` for competition evidence and implementation limits.

## Storage and limits

This is a local hackathon prototype, using simulated funds, fixed illustrative exchange rates and simulated provider quotes. Bank delivery estimates skip weekends, not jurisdiction-specific bank holidays. Sandbox execution settles immediately for the demonstration. No real bank, KYC, payment network or live rate source is connected.

Sessions are isolated by an HttpOnly, SameSite cookie and persisted in an encrypted, ignored `data/sessions.json` vault. Its development key is in ignored `data/sessions.json.key`, or supplied through `FINMATE_STORAGE_KEY` as 64 hexadecimal characters. Keep the original key: losing it makes saved accounts inaccessible. Protect the key separately; possession of both files permits decryption. The UI's old browser-only state is no longer authoritative. Run one server process. This is not a production financial service.

## Design

Warm paper, aubergine ink, serif headlines, small interface typography, ledger rows, fine rules and original line illustrations. References: [Wise Design](https://wise.design/) and [Slash](https://www.slash.com/). Their proprietary assets are not used.

## Live model smoke evaluation

Run `node tools/evaluate-live.mjs` with your configured provider to repeat the fourteen synthetic cases. This makes real API calls and writes a report to `docs/live-model-evaluation.json`. It uses temporary isolated accounts, not browser session data. To repeat one case and retain the other results for the same model, pass its exact case name, for example `node tools/evaluate-live.mjs "No fictional scholarship"`.

The ElevenLabs key is preserved in the server environment; voice features are not currently integrated.

Atomic session-file replacement retries transient Windows file-lock errors with bounded backoff. Permanent storage failures roll back the attempted mutation. Semester and next-decision requests require the dated planning tool after reading finances.

## Source submission

See `docs/submission.md` for the code entry points, reproducible checks and packaged-file scope. `FinMate-source.zip` contains source, tests, samples and technical documentation. It excludes `.env`, saved sessions, dependencies, screenshots and local logs. Copy `.env.example` to `.env` and configure a key only if you want the live agent; the offline tools work without one.

Run `node tools/export-sandbox-evidence.mjs` to generate synthetic execution evidence independently of browser sessions or API keys. It records an expired quote and incorrect-PIN rejections followed by a newly approved sandbox payment.

## First-time experience

Home introduces the practice account and a five-step starting guide: enter balances, personalize the plan, check tuition details, set a payment PIN, then review funding. The assistant opens on demand from Ask FinMate. Tuition displays a three-stage payment flow, and Money Plan provides shortcuts to semester dates, purchase checks, living budgets and optional scenarios. Navigation supports browser Back and moves keyboard focus to the new page. Sample balances stay explicitly labeled; all payment controls still use the same backend authorization.


## Desktop visual edition

Home includes a tuition brief and a currency ledger. On desktop, invoice details stay beside payment options; semester dates use two columns, and setup shows the practice-account context alongside the form. Typography, receipts, forms and assistant styling are consistent across the workspace. The payment authorization rules are unchanged.


## Use your own balances

Choose Home → Add my balances, or Manage balances in the currency ledger/profile. Enter EUR, GBP and CNY starting balances (zero for a currency you do not hold), review the source disclosure and confirm. These are self-reported planning snapshots, not connected or bank-verified accounts. You may remove the example transactions and sample scholarship forecast while preserving imported statement history. Review the profile, budget and tuition details separately in the student plan.

Manage balances → Record a simulated deposit credits a selected sandbox account after explicit confirmation. It creates one transaction, audit record and deposit receipt. Retries with the same request identifier return the original receipt; changing the payload is rejected. All quotes and pending approvals require fresh review after account changes. Starting balances lock after a simulated deposit or executed payment so the ledger cannot be silently overwritten. A fresh sandbox account starts a new scenario.

No real deposit, bank transfer or account verification takes place. Imported transactions and expected-income forecasts do not credit balances. The AI can read balances and their provenance, but cannot set them or record deposits. Deposit receipts are included in execution exports.

## Competition update

Home or Tuition → Solve my tuition problem builds a complete workflow from the saved invoice and current account snapshots. Choose an explicit preferred currency and optional backups. Income-delay assumptions never add spendable funds. Review blockers, eligible/rejected routes and changed plans, then confirm preparation and separately approve the exact payment with a PIN. The server rechecks the reviewed workflow digest before preparing.

The assistant and workflow offer English and simplified Chinese explanations. The wider navigation and payment approval forms remain English. Financial identifiers and numeric approvals are never translated. Affordability conclusions render from deterministic calculation results in both languages, distinguishing the payment-time EUR living reserve from the 60-day emergency buffer.

ECB reference observations have a visible source, date, freshness and connectivity status. A fixed validated observation supports offline judging. Reference updates do not change simulated provider quotes or payment approvals.

Run node tools/evaluate-benchmark.mjs with a configured provider for the 24-scenario, three-repeat live evaluation. It records results, failures, measured tokens, latency, corrections and approval/balance invariants. It is a locally authored bounded evaluation, not an independently held-out benchmark or a general safety claim. See docs/benchmark-human-review.md for the explanation issue caught beyond the automated assertions.

Submission preparation is described in docs/submission.md. The presentation is in the separate submission folder. A continuous desktop demo requires a person to choose its surface in the browser sharing picker. The student study kit is ready in docs/student-study.md, but no participant results are claimed.

Provider availability failures use a visibly labeled offline planner with the same approval boundaries. The live evaluators disable that fallback and retain failures.
