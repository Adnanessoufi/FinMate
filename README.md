# FinMate

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

You need Node.js 22.18 or newer.

```bash
npm ci --ignore-scripts
cp .env.example .env
npm start
```

On PowerShell, use `Copy-Item .env.example .env` to copy the file.

Open http://127.0.0.1:5187.

Add your OpenAI key to `.env` and choose the model with `FINMATE_MODEL`. Restart the server after changing these settings. Without a key, the app uses its offline planner. It also labels offline responses when the provider is unavailable.

## Tests

```bash
npm test
```

## Built with

HTML, CSS, JavaScript and Node.js. PDF.js reads invoices, OpenAI handles the agent conversation, and the ECB feed provides reference exchange rates. Payment quotes use separate simulated rates.

The agent can read finances and prepare drafts. Approval requires the student's PIN. Starting balances are entered manually, and expected income is not available money until it arrives.

Saved accounts are encrypted in `data/`. Keep the storage key to retain access to them. API keys and saved accounts stay outside Git. Live chat sends messages and financial tool results to the configured model provider; invoice extraction stays local.

Third-party licenses are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
