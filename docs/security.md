# Security self-assessment

## Permission tiers

| Tier | Allowed | Authority |
|---|---|---|
| Read | Balances, invoice, budget, recent transactions, projections | Agent tools and session owner |
| Prepare | Route comparison and payment draft | Agent tools and session owner; no funds move |
| Approve | Explicit approval of a displayed digest-bound draft | Separate UI action with payment PIN, session, origin and CSRF checks |
| Execute | Execute the approved immutable plan | Backend only, with matching approval token and renewed checks |

The model cannot invoke approve, execute, invoice verification, budget changes or demo reset. Unknown tools and unexpected argument keys are rejected. Uploaded text is treated as data. Local invoice extraction does not execute document instructions; field verification does not count as payment approval.

## Controls implemented and tested

- Source balance and target-amount calculations validated by the server.
- Tuition deadlines and euro living-cost reserves enforced.
- Two-minute quote expiry, market version, account revision and invoice identity checked at approval and execution.
- Approval binds recipient, account, amount, currency, route, fee, rate and deadline through the draft digest.
- Random approval tokens stored as hashes and checked in constant time within their owning session. Malformed identifiers and prototype-property aliases are rejected.
- Serialized execution and stored receipts prevent concurrent duplicate payment.
- Paid invoice references cannot be re-verified as a new payment even if a different recipient account is submitted.
- HttpOnly SameSite session cookie; exact local host, Origin and CSRF checks on POST routes.
- Explicit static asset allowlist prevents serving .env, server code, or stored session data.
- Upload size and PDF page bounds; text evaluation disabled in PDF.js.
- HTML escaping for user messages, invoice fields, transaction descriptions and audit details.
- No API key in browser assets, exports or account storage.

## Known risks and prototype limits

1. This is a local simulated financial service. It has no user login, independent MFA, TLS termination, KYC, sanctions checks or real bank account verification. Do not expose this server publicly.
2. Session storage uses AES-256-GCM authenticated encryption. The default development key is stored beside the vault in a separate ignored file; this protects a vault-only disclosure, not access to both files. OS account permissions and folder synchronization settings still apply. A local administrator or compromised server can access the key. Prefer an externally supplied key for deployment. Migration cannot erase old plaintext backups or cloud version history.
3. Vault authentication rejects unauthorized changes to stored content, and audit checks reject broken chains before loading, reading or saving accounts. The chain is not independently anchored: rollback to an older valid vault or a rewrite by someone with the encryption key remains possible.
4. A digest-bound approval endpoint cannot cryptographically prove a human clicked the UI. Every HTTP approval now requires a payment PIN checked against a salted scrypt hash. This raises the barrier for cookie-only theft, but compromised same-origin code can capture a typed PIN. It is not an independent second factor. Production approval should use an independently authenticated factor.
5. Model output may contain hallucinations or misleading narratives. The backend limits actual actions, but broad prompt-injection resilience and real-model answer quality have not been proven. Current tests cover known examples and tool permission boundaries.
6. Live chat shares messages and derived financial tool results with the configured model provider. Provider retention, residency and consent policy need review before processing real student data.
7. Invoice extraction handles labeled text, not arbitrary layouts or scanned images. Manual verification remains mandatory; document authenticity is not verified.
8. Rates, providers, fees and delivery times are fixtures. Business-day estimates skip weekends only. Sandbox settlement is immediate. Forecasts assume income and spending, exclude conversion fees until execution, and do not guarantee liquidity.
9. The file store supports one process and is appropriate for a prototype, not horizontally scaled execution. Production needs a transactional database, durable idempotency keys, external reconciliation, rate limits, log retention and independent audit storage.

## Evidence to submit

Run the normal payment flow and expiry demonstration, then export execution evidence from Activity. Include the automated test output, architecture, this assessment and the demo video. The saved live-model report covers twelve targeted synthetic cases; repeating it requires a provider key.

Combined tuition plans bind every selected account contribution to the approval digest. Execution rechecks the stored content digest and all contributing balances before committing. These atomic guarantees apply to the local simulated ledger; external payment providers would require separate reconciliation.

## Tuition Guardian and family privacy

Guardian establishes its initial comparison from the sandbox seed or an existing user-verified invoice when migrating a saved session. That baseline is not externally authenticated. New account, recipient, amount or currency changes and reference reuse pause tuition route comparison, funding comparison, preparation, approval and execution. The user must separately choose a trusted-contact method, write a note and confirm the exact comparison digest and account revision. The agent has no change-review tool. Later changes invalidate that review. Student setup uses the same invoice path and cannot bypass it. Previously paid references are blocked regardless of submitted account changes; references are treated as unique within the student's session.

Family previews use selected balances only, never future income. Conversion rounding must cover the shortfall after illustrative fees. Creating a request requires a matching preview digest and explicit user confirmation; rates, invoice, balances, day and sharing changes invalidate the preview. Downloads are session-private, and contain no structured account numbers, references, balances or income details. Name, university, total tuition and own contribution are optional. A user-entered name or recipient label could itself contain personal information, so the exact text is shown before creation. Prepared snapshots remain inside encrypted local session storage, bounded to the latest twenty requests. The app does not authenticate family members, transmit requests, confirm incoming funds or execute family contributions.

## Security hardening added

- AES-256-GCM uses a fresh 96-bit nonce per write and authenticates the complete session payload with a versioned context. Files use atomic replacement; key generation is exclusive and existing encrypted data never receives a replacement key automatically.
- Legacy migration preserves balances, session identifiers and audit entries. Cipher authentication or audit failures stop startup instead of resetting accounts. Mutations work on a clone and become visible only after durable persistence succeeds.
- HTTP approval checks the current PIN against a salted scrypt hash (N=16384, r=8, p=1, 32-byte output) after checking the exact draft. Five failures lock for five minutes; counters are persisted. Correct PINs cannot bypass the lock. PIN changes require the existing PIN, rotate CSRF, invalidate quotes and revoke pending approvals. Normal financial exports never contain PIN hashes, salts, vault keys or authorization tokens.
- HTTP request limits are 300 API requests/minute per socket IP, 30 bootstrap requests/minute per socket IP, 12 model requests/minute per socket IP, and 15 PIN/approval requests/minute per session. At most two model tasks run concurrently. Forwarded-IP headers are not trusted. Local storage caps new sessions at 100 without deleting existing account data. Counters other than PIN failures are in memory and reset with the process.
- JSON bodies must be UTF-8 objects, at most 1.6 MB, with bounded nesting and complexity. Prototype-related keys and unknown root fields are rejected. Model arguments must match the permitted types, enums, required fields and bounds before any financial tool runs.
- Cross-site browser API calls are rejected using fetch metadata in addition to exact Host, Origin and CSRF controls. The server uses frame denial, restrictive permission policy, no-store responses and a same-origin opener policy. Approval tokens remain server-issued and scoped to their originating session.
- Structured PIN fields never enter model context. Chat detects labeled numeric PINs and API-key-looking strings and refuses them before provider calls or history storage; this is a bounded pattern check, not general data-loss prevention.

Implementation references: [Node.js crypto](https://nodejs.org/api/crypto.html) and [OWASP transaction authorization guidance](https://cheatsheetseries.owasp.org/cheatsheets/Transaction_Authorization_Cheat_Sheet.html). These are design references, not a certification or complete compliance claim.


## Balance entry and simulated credit boundary

Starting balance entry and simulated deposit recording are human-only HTTP actions. The AI has no such tools. These actions require the session's Origin and CSRF token, explicit confirmation, strict allowed fields and valid amounts/currencies. Opening balance changes require the current revision and are blocked after deposit or payment activity. Deposits use a session-scoped idempotency identifier, fingerprint checks, bounded receipt history and serialized encrypted persistence; retries and concurrent identical requests credit once. Failed persistence leaves the previous balance and evidence intact. Credits and balance corrections invalidate old quotes and unused approvals.

Manual balance inputs and simulated deposits are not bank-verified evidence. Possession of the local session allows the owner to enter hypothetical numbers; this is not authentication of real funds. A real deployment must obtain trusted balances and incoming-funds evidence from authorized integrations. Imported statements and forecast income do not mint funds. Exports include simulated deposit receipts and their audit links, without internal fingerprints or credentials.

## Tuition workflow and reference data

Workflow preparation requires a digest bound to the day, selected accounts, saved invoice, account balances, living budget, Guardian comparison and simulated rates. It rechecks current eligibility and consent before creating a payment draft. Approval and execution still use the existing PIN, exact-draft and idempotency checks. Read-only goal tools cannot approve, execute or mint funds.

Reference feeds use one fixed HTTPS ECB endpoint and do not accept caller URLs. Fetches, bytes, currency fields and observation dates are bounded, with an offline fallback. Reference values never enter execution quotes. English and Chinese explanations preserve identifiers and amounts. Credential-looking Chinese disclosures are refused before a model call. Numeric purchase conclusions come from engine fields rather than free-form model arithmetic.

Dependency review identified GHSA-hq66-cqwq-w95j / CVE-2026-16633 in pdfjs-dist 5.6.205. The app now pins patched 6.2.108, disables scripting/expression evaluation, and includes the lockfile and third-party notices. npm reported zero known vulnerabilities for the installed tree on 11 October 2026. This is a point-in-time package advisory check, not a security certification. Source: https://github.com/mozilla/pdf.js/security/advisories/GHSA-hq66-cqwq-w95j .

Provider availability errors fall back to an explicitly labeled deterministic planner. Financial guard failures do not trigger fallback. Neither route can approve or execute, and the fallback is recorded in the audit. Live evaluation scripts disable fallback so its answers cannot be counted as model successes.
