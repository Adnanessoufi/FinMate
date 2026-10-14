# Security design

I kept payment approval separate from the agent. A useful plan is not permission to spend money. The student has to review the exact draft and confirm it with a PIN.

## Who can do what

| Action | Who can do it |
|---|---|
| Read finances and compare options | Student and agent tools |
| Prepare a payment draft | Student and agent tools |
| Approve a draft | Student, through the PIN-protected HTTP action |
| Execute a payment | Backend, after checking the approval |
| Enter balances or record a simulated deposit | Student, with explicit confirmation |
| Review an invoice change | Student, through the separate Guardian review |

The model has no approval or execution tool. It cannot enter a PIN, credit an account or clear an invoice warning. Tool names and arguments are checked before use. Instructions inside an uploaded invoice do not grant permissions.

## Payment checks

Approval is tied to the draft's recipient, account, amount, currency, fees, rate, deadline and funding accounts. The server checks the invoice identity, account revision and market version again at execution. Quotes expire after two minutes.

A payment must preserve the living reserve and arrive within the tuition deadline. Combined funding changes all contributing accounts together. Stored receipts and serialized updates prevent a repeated request from paying twice.

Changed invoice details require a separate Guardian review. Later changes invalidate that review. Paid invoice references cannot be reused for another payment.

PINs are stored as salted scrypt hashes. Five failed attempts lock approval for five minutes. Changing the PIN revokes pending approvals. PIN fields stay outside model context, and exports exclude internal credentials.

## Requests and saved data

Session cookies use HttpOnly and SameSite. State-changing requests need the expected Host, Origin and CSRF token; fetch metadata is checked too. The server limits requests and accepts only listed static files.

JSON bodies and uploads have size limits. PDF extraction has a page limit, with scripting and expression evaluation disabled. User-provided text is escaped before it enters the page. Detected credential strings in chat are refused before provider calls, though this filter cannot catch every possible disclosure.

Saved accounts use AES-256-GCM encryption. Writes replace the file atomically, and a failed save leaves the previous account state intact. Missing keys, invalid ciphertext or broken audit chains block access.

Simulated deposits use request identifiers so retries cannot credit money twice. CSV imports and forecast income do not add funds. The ECB feed uses a fixed URL with timeout and size limits; it cannot change execution quotes.

When the model provider is unavailable, the app labels its offline answer and records the fallback. A failed financial check cannot be bypassed by switching to that planner.

## What this does not protect against

FinMate is a local prototype with simulated payments. It has no bank connection, user login, independent MFA, KYC or real settlement. The server should not be exposed publicly.

Manual balances are unverified. Invoice verification confirms entered fields, not document authenticity. Family requests are private downloads; the app does not send them or verify a contribution.

The file store supports one process. Its default key is kept beside the encrypted data, so someone who obtains both can read the accounts. The audit chain is not independently anchored and cannot stop rollback by someone with the key. Compromised same-origin code could capture a typed PIN.

Live chat sends messages and financial tool results to the configured model provider. The backend limits financial actions, but that does not make every model explanation correct or prove resistance to every prompt injection.

Tests and known failures are described in [evaluation.md](evaluation.md). Library licenses are included in the repository.
