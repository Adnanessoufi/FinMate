# Security

## Permissions

The agent can read finances, compare options and prepare a draft. It cannot approve or execute payments, enter a PIN, change balances or clear an invoice warning. Tool names and arguments are validated before use.

Payment approval is a separate user action with a PIN. Approval binds the recipient, account, amount, currency, fees, rate, deadline and selected funding accounts to the exact draft. Execution checks the draft again before changing balances.

## Implemented controls

- Server checks balances, protected living costs, invoice identity, account revision, market version and two-minute quote expiry.
- Serialized payments and stored receipts prevent duplicate execution. Combined funding commits all account changes together.
- Changed invoice details require a separate Guardian review. Paid invoice references cannot be reused.
- PINs use salted scrypt hashes. Five failures cause a five-minute lock; changing the PIN revokes pending approvals.
- HttpOnly SameSite cookies, exact Host and Origin checks, CSRF tokens and fetch metadata protect session actions.
- Request limits, bounded JSON bodies, upload sizes and PDF pages limit resource use. Static files use an explicit allowlist.
- User-provided text is escaped. PDF scripting and expression evaluation are disabled.
- Accounts use AES-256-GCM encryption and atomic writes. Failed persistence leaves the previous state intact. Missing keys, invalid ciphertext and broken audit chains block access.
- Starting balances and simulated deposits require explicit user confirmation. Deposits are idempotent; CSV imports and expected income cannot credit accounts.
- PIN fields stay outside model context. Detected credential strings are refused before provider calls. Keys and internal credentials are excluded from exports.
- The ECB reference feed has a fixed endpoint, timeout and size bounds. Reference rates never replace simulated execution quotes.
- Provider failures use a labeled, audited offline planner. Financial guard failures do not trigger fallback.

## Limits

This is a local simulated service. It has no bank connection, user login, independent MFA, KYC or real settlement. Do not expose the server publicly.

Manual balances are unverified. Invoice verification confirms entered fields, not document authenticity. Delivery estimates skip weekends only; forecasts depend on assumed income and spending.

The file store supports one process. The default vault key is stored beside the encrypted data: access to both files defeats that protection. The audit chain is not independently anchored and cannot prevent rollback by someone with the key. Same-origin compromise can capture a typed PIN.

Live chat sends messages and financial tool results to the configured model provider. Credential filtering is a bounded pattern check. Synthetic tests establish known permission boundaries, not general resistance to prompt injection or model errors.

Family requests are reviewed private downloads. The app does not send them or verify incoming contributions.

See [evaluation.md](evaluation.md) for measured results and known failures. PDF.js is pinned to 6.2.108; its license and dependency notices are included in the repository.
