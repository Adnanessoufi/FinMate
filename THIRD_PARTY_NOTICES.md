# Third-party notices

The example names, invoices and financial records in FinMate are synthetic. No bank or transfer provider is connected.

- PDF.js / pdfjs-dist 6.2.108, Mozilla and contributors, Apache License 2.0. Upstream: https://github.com/mozilla/pdf.js . License included at docs/licenses/pdfjs-Apache-2.0.txt. Invoice extraction disables scripting and expression evaluation. The npm lockfile records the installed dependency tree.
- Optional @napi-rs/canvas dependency supplied through PDF.js, MIT license, upstream https://github.com/Brooooooklyn/canvas . Its dependency license is included at docs/licenses/canvas-MIT.txt. Platform packages and licenses are recorded in the lockfile and npm distribution.
- node-postgres / pg 8.23.1 and its dependency tree, used for hosted PostgreSQL access. Upstream: https://github.com/brianc/node-postgres . The driver is MIT licensed; its license is included at docs/licenses/pg-MIT.txt. Individual dependency licenses are retained in npm packages and recorded in the lockfile.
- PGlite 0.5.11, Apache License 2.0, used only as a development dependency for PostgreSQL tests. Upstream: https://github.com/electric-sql/pglite . License included at docs/licenses/pglite-Apache-2.0.txt.
- DM Sans and DM Serif Display, served through Google Fonts, SIL Open Font License 1.1. Upstream license pages: https://github.com/google/fonts/blob/main/ofl/dmsans/OFL.txt and https://github.com/google/fonts/blob/main/ofl/dmserifdisplay/OFL.txt . Fonts are loaded from the font service, not bundled into the source archive.
- European Central Bank reference-rate data: https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html . Reference observations are attributed and dated. They are informational, not executable transaction prices. See ECB reuse terms: https://www.ecb.europa.eu/services/disclaimer/html/index.en.html . ECB data does not imply endorsement.
- OpenAI or another configured compatible model API is an optional external service. Users must configure an authorized account and follow its terms. API credentials and local sessions are excluded from the archive.

Third-party licenses remain with their owners.
