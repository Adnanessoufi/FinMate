# FinMate

[Open FinMate](https://finmate-omega.vercel.app)

I made FinMate to help international students manage tuition and living costs abroad.

Enter your balances, upload a tuition invoice and compare payment options. FinMate checks fees and arrival dates while protecting your living budget. You review the payment and confirm it with a PIN.

Accounts and payments are simulated. No real bank is connected.

## Run it

Use Node.js 22.18 or newer in the 22.x release line.

```bash
npm ci --ignore-scripts
cp .env.example .env
npm start
```

On PowerShell, use `Copy-Item .env.example .env`.

Open http://127.0.0.1:5187.

For live chat, add `OPENAI_API_KEY` and choose `FINMATE_MODEL` in `.env`, then restart. Without a working key, the app labels its responses as coming from the offline planner.

## Deploy on Vercel

Import this repository and connect a PostgreSQL database. Set these server-side variables:

- `DATABASE_URL`: the pooled database connection URL
- `FINMATE_STORAGE_KEY`: a fixed 64-character hexadecimal encryption key
- `OPENAI_API_KEY` and `FINMATE_MODEL`: optional live chat settings

The included configuration builds the public files and deploys the API. For a custom domain, set `FINMATE_PUBLIC_ORIGIN` to its exact HTTPS origin. Redeploy after changing variables.

Hosted chat allows 100 agent requests per 24-hour window by default. Change this with `FINMATE_DAILY_AGENT_LIMIT`.

## Tests

```bash
npm test
```

The tests cover payment approvals, invoice checks, account isolation and failed requests. They also check that concurrent requests cannot duplicate payments or deposits.

## Data and permissions

The agent can read finances and prepare payment drafts. Approval requires your PIN. Expected income does not count as available funds, and importing a statement does not change balances.

Local sessions are encrypted in `data/`. Hosted sessions are encrypted in PostgreSQL. Keep the storage key separately; losing it makes the saved data unreadable. Keys and account data stay outside Git.

Live chat sends messages and financial tool results to the configured model provider. Invoice text extraction runs on the server. The public app has no user login, so use synthetic data when trying it.

Built with HTML, CSS, JavaScript and Node.js. PDF.js reads invoices. ECB reference rates are informational; payment quotes use simulated rates.

Third-party licenses are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
