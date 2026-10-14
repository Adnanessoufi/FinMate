# How FinMate works

I made FinMate for international students who need to plan tuition payments while keeping enough money for daily life. This version runs locally and uses simulated accounts.

## System architecture

The browser runs HTML, CSS and JavaScript. It sends requests to a Node.js server. The server owns the account state and checks whether a payment is allowed.

```text
Browser -> Node.js HTTP API -> financial engine -> encrypted account store
                         -> agent -> optional model API
                         -> local PDF/TXT extraction
                         -> ECB reference feed
```

The agent calls a fixed set of backend tools. It can read finances, compare payment options and prepare a draft. Approval and execution have separate HTTP routes, so a model response cannot move money by itself.

| File | What it does |
|---|---|
| `server.mjs` | HTTP routes, session checks and allowed static files |
| `backend/engine.mjs` | Payment calculations, funding plans and execution checks |
| `backend/agent.mjs` | Model calls, tool selection and offline planner |
| `backend/store.mjs` | Account state, serialized updates and audit records |
| `backend/vault.mjs` | Encryption and file persistence |
| `backend/security.mjs` | Payment PINs, request limits and input checks |
| `backend/invoice.mjs` | PDF/TXT extraction and invoice verification |
| `backend/guardian.mjs` | Invoice changes and separate review |
| `backend/accounts.mjs` | Starting balances and simulated deposits |
| `backend/forecast.mjs` | Dated income and expense scenarios |
| `backend/affordability.mjs` | Purchase limits |
| `backend/student.mjs` | Profile, budget and income settings |
| `backend/semester.mjs` | Planning actions for the semester |
| `backend/mission.mjs` | Reviewed tuition workflow |
| `backend/family.mjs` | Family contribution estimates and private downloads |

## Core algorithms

### Comparing payment routes

Each simulated provider has a fee percentage and an estimated delivery time. The engine converts through the saved EUR value of each currency:

```text
rate = EUR value of source currency / EUR value of target currency
fee = round(source amount * fee percentage, 2)
received = round((source amount - fee) * rate, 2)
```

For tuition, the target amount comes from the verified invoice. The engine estimates the source amount needed after fees, rounds it up to cents, and increases it by one cent until the received amount covers tuition. Direct payments in the invoice currency have no conversion fee.

A route is eligible only if the source account has enough money, its estimated arrival is on or before the deadline, and the EUR account keeps the required living reserve. That reserve is the saved monthly essentials plus the emergency buffer. Arrival estimates skip weekends, but do not account for public holidays.

Eligible routes appear first, ordered by their fee cost in EUR. Blocked routes keep their reasons visible. A cheap route that arrives late cannot become the recommended payment.

### Combining accounts

The engine follows the preferred account first, then the selected backup accounts. It subtracts the protected reserve from the available EUR balance before allocating anything.

For each account, a binary search over integer cents finds the smallest debit that covers its share of the remaining tuition after fees. The process continues until tuition is covered or the selected accounts run out. The plan uses the latest arrival among its contributions and checks the resulting balances.

This follows the selected account order. It does not search every possible allocation for a global optimum. Execution applies all contributions together, so a failed check cannot leave a partially paid plan.

### Forecasting and purchase limits

The forecast starts from the combined EUR value of current balances. It places rent on the saved rent day, weekly essentials on Mondays, verified unpaid tuition on its due date, and expected income on its scheduled dates. Scenarios can reduce the CNY rate, delay income or increase rent. Each day's balance is the previous balance plus that day's events.

Purchase checks use a 60-day forecast. They subtract all expected income from the projection before calculating the spending limit. If the income-free forecast already falls below the buffer, the spending limit is zero. Otherwise, the engine converts the room above the buffer into the purchase currency and takes the smaller of that amount and the available paying-account balance. It rounds the limit down to cents. EUR purchases also preserve monthly essentials in that account. Converted purchase costs round upward.

If the unpaid invoice is unverified, FinMate does not give a spending limit. It also separates the projected emergency buffer from the reserve protected in the EUR account at payment time. Forecasts use assumptions and exclude conversion fees; they are not guaranteed cash availability.

### Preparing and executing a payment

The student verifies the invoice and separately reviews any Guardian warning. The engine prepares a draft with the exact quote, invoice identity, account revision, market version and expiry. A digest identifies those contents.

The student reviews the draft and confirms it with a PIN. Execution rechecks the approved contents and current eligibility before saving the payment. Retrying an executed draft returns its stored receipt. The complete tuition workflow also checks that the reviewed balances, budget and allowed accounts have not changed before preparing a draft.

## Account data

Starting balances are entered manually. CSV imports add transaction history without changing balances. Expected income stays in the forecast until it is actually recorded as received. Opening balances lock after deposit or payment activity. Simulated deposits require confirmation and a unique request identifier to prevent duplicate credits.

Each session has its own state. Updates are checked on a copy and become visible after a successful save. The store uses AES-256-GCM encryption and a hash chain for audit records. Failed writes leave the previous state intact.

The ECB feed provides dated reference rates through a fixed endpoint with size and timeout limits. Invalid observations fall back to the last validated reference. These rates stay separate from simulated payment quotes.

The security controls and their limits are in [security.md](security.md).
