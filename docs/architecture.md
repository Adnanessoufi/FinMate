# Architecture

FinMate runs as a local Node.js server. The frontend uses HTML, CSS and JavaScript and calls the HTTP API in `server.mjs`.

The financial calculations are in the backend. The browser does not decide whether a payment is allowed.

## Main files

| File | Purpose |
|---|---|
| `server.mjs` | HTTP routes, allowed static files, sessions and request validation |
| `backend/store.mjs` | Saved accounts, serialized changes and audit records |
| `backend/engine.mjs` | Quotes, tuition funding, approval checks and execution |
| `backend/agent.mjs` | Model calls, allowed tools and offline fallback |
| `backend/invoice.mjs` | Local PDF/TXT extraction and field verification |
| `backend/guardian.mjs` | Invoice differences and separate change review |
| `backend/accounts.mjs` | Starting balances and simulated deposits |
| `backend/forecast.mjs` | Dated cash-flow scenarios |
| `backend/affordability.mjs` | Purchase limits without relying on future income |
| `backend/student.mjs` | Student profile, budget and income settings |
| `backend/semester.mjs` | Dated planning actions |
| `backend/mission.mjs` | Complete tuition workflow and reviewed plan snapshot |
| `backend/family.mjs` | Private family-contribution estimates and downloads |
| `backend/security.mjs` | PINs, request limits and tool validation |
| `backend/vault.mjs` | Encrypted storage |

## Agent tools

The model can read finances, compare routes, calculate scenarios and prepare drafts. Approval and execution are separate HTTP actions and are not model tools.

Tool names and arguments are checked before use. Messages, invoice fields and transaction descriptions do not grant permission to make payments. The model has bounded iterations, tool calls and request timeouts.

English and Chinese purchase answers use the calculated amounts directly. When the provider is unavailable, the app labels the offline planner response and records the fallback.

## Payment flow

1. The student verifies the invoice. Changed details may also need a separate Guardian review.
2. The engine compares current balances, fees, arrival dates and the protected EUR reserve.
3. A draft records the exact quote, invoice, account revision, market version and expiry.
4. The student confirms the displayed draft with their PIN.
5. Execution checks the approved contents again and commits the account changes together.
6. Retrying the same execution returns its stored receipt.

Combined funding uses the preferred account first, then only the selected backups. Conversion amounts are searched in integer cents so rounding does not underfund tuition. This follows the selected account order, not every possible allocation.

The tuition workflow also binds its reviewed snapshot to the day, invoice, balances, budget and allowed accounts. A changed snapshot cannot prepare a new payment using old consent.

## Planning and account inputs

Starting balances are manual snapshots. CSV imports add transaction history without changing balances. Expected income affects scenarios but does not become spendable money.

Opening balances lock after a simulated deposit or payment. Deposits need explicit confirmation and an idempotency identifier. A duplicate identifier cannot credit money twice or be reused for a different amount.

Purchase planning checks both the paying account and the 60-day projection. The reserve protected at payment time is different from the emergency buffer used in the longer projection.

## Storage

Each session has its own account state. Changes operate on a copy, are checked and saved, and become visible only after persistence succeeds. A failed write keeps the previous account state.

The journal uses AES-256-GCM encryption. The local storage key is kept separately from the journal. Audit entries form a hash chain. Missing keys, damaged ciphertext or broken audit records block account access.

## Exchange-rate references

The ECB feed is fetched from a fixed URL with a timeout and size limit. Invalid, incomplete, future or older observations fall back to the last validated reference. The UI shows the source, observation date and freshness.

These values are informational. They never replace the simulated provider rates used in payment quotes.

Known risks and the permission tiers are in [security.md](security.md).
