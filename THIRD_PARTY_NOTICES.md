# Third-party notices

The example names, invoices and financial records in FinMate are synthetic. No bank or transfer provider is connected.

- PDF.js / pdfjs-dist 6.2.108, Mozilla and contributors, Apache License 2.0. Upstream: https://github.com/mozilla/pdf.js . License included at docs/licenses/pdfjs-Apache-2.0.txt. The pinned version replaces 5.6.205 after review of GHSA-hq66-cqwq-w95j (CVE-2026-16633). Invoice extraction disables scripting and expression evaluation. The npm lockfile records the installed dependency tree.
- Optional @napi-rs/canvas dependency supplied through PDF.js, MIT license, upstream https://github.com/Brooooooklyn/canvas . Its dependency license is included at docs/licenses/canvas-MIT.txt. Platform packages and licenses are recorded in the lockfile and npm distribution.
- DM Sans and DM Serif Display, served through Google Fonts, SIL Open Font License 1.1. Upstream license pages: https://github.com/google/fonts/blob/main/ofl/dmsans/OFL.txt and https://github.com/google/fonts/blob/main/ofl/dmserifdisplay/OFL.txt . Fonts are loaded from the font service, not bundled into the source archive.
- European Central Bank reference-rate data: https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html . Reference observations are attributed and dated. They are informational, not executable transaction prices. See ECB reuse terms: https://www.ecb.europa.eu/services/disclaimer/html/index.en.html . ECB data does not imply endorsement.
- OpenAI or another configured compatible model API is an optional external service. Users must configure an authorized account and follow its terms. API credentials and local sessions are excluded from the archive.
- ElevenLabs is used only for optional demo narration through the user's configured account. Voice is generated narration, not a student testimonial. Generated media is separate from application source and must be used under the account's applicable terms.

Screenshots use synthetic account data. Third-party licenses remain with their owners.
