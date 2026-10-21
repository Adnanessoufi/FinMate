# FinMate

[Open FinMate](https://finmate-omega.vercel.app)

I made FinMate to help international students manage tuition, living costs and money from home.

The student enters their balances and uploads a tuition invoice. FinMate compares payment options and keeps money aside for living costs. The student reviews the payment and confirms it with a PIN.

Accounts and payments are simulated. No real bank is connected.

## What it does

- Manage EUR, GBP and CNY balances
- Read PDF and TXT invoices
- Compare fees and arrival dates, including funding from selected accounts
- Check purchase affordability and upcoming expenses
- Explain plans in English or Chinese
- Save payment approvals, receipts and audit history

## Run it

You need Node.js 22.18 or newer in the 22.x release line.

```bash
npm ci --ignore-scripts
cp .env.example .env
npm start
```

On PowerShell, use `Copy-Item .env.example .env` to copy the file.

Open http://127.0.0.1:5187.

Add your OpenAI key to `.env` and choose the model with `FINMATE_MODEL`. Restart the server after changing these settings. Without a key, the app uses its offline planner. It also labels offline responses when the provider is unavailable.

## Host on Vercel

Import this repository into Vercel. The included configuration builds the public files and runs the API as one function.

Connect a PostgreSQL database and set these server-side environment variables:

- `DATABASE_URL`: the database's pooled connection URL, with TLS enabled
- `FINMATE_STORAGE_KEY`: a fixed 64-character hexadecimal key, stored separately from the database
- `OPENAI_API_KEY` and `FINMATE_MODEL`: optional live agent settings

Vercel's deployment domains are allowed automatically. For a custom domain, set `FINMATE_PUBLIC_ORIGIN` to its exact HTTPS origin. Never put keys in browser code. Redeploy after changing environment variables.

The hosted app starts separate sandbox sessions for visitors. Cookies use HTTPS, and database version checks prevent concurrent requests from overwriting payments. Request limits are shared across function instances. Hosted chat allows 100 agent requests per 24-hour window by default; change this with `FINMATE_DAILY_AGENT_LIMIT`. This is still a simulated account app without a user login; use synthetic data for public demonstrations.

## Tests

```bash
npm test
```

## Built with

HTML, CSS, JavaScript and Node.js. PDF.js reads invoices, OpenAI handles the agent conversation, and the ECB feed provides reference exchange rates. Payment quotes use separate simulated rates.

The agent can read finances and prepare drafts. Approval requires the student's PIN. Starting balances are entered manually, and expected income is not available money until it arrives.

Local accounts are encrypted in `data/`. On Vercel, encrypted sessions are stored in PostgreSQL. Keep the storage key to retain access to them. API keys and saved accounts stay outside Git. Live chat sends messages and financial tool results to the configured model provider; invoice extraction stays local.

Third-party licenses are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
