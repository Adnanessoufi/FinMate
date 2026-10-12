# Competition submission checklist

Verified against the International Track section of https://fintechathon.g-ican.com/#/en/rule on 11 October 2026, including the Chinese reference. Do not use Domestic Track November deadlines.

The current website marks English technical documentation, a presentation deck with up to 10 minutes of presentation, and a demo video up to 5 minutes as required. It marks source code, security self-assessment and execution evidence optional. Its downloadable/circulated Topic Rules PDF lists a different checklist, including source/README/GitHub/deployment/tests and security/execution evidence. Submit the full package to cover both published versions and follow any later organizer confirmation. Source code alone is not the current website's submission checklist.

## Deliverables and status

- Technical documentation: architecture.md, security.md and evaluation.md, ready.
- Presentation: submission/FinMate-competition.pptx, editable English deck with speaking notes. Rehearse under 10 minutes and add your actual team details outside the existing product content if required by the registration template.
- Demo: new continuous desktop recording plan and English narration are prepared in submission/. Capture needs user selection in the browser sharing picker, then a final edited and verified video. The earlier root MP4 files predate the updated app and are drafts.
- Source: FinMate-source.zip, safe environment template, lockfile, README, tests, samples and third-party notices. Credentials, vaults, local keys, node_modules and private build directories are excluded.
- Security self-assessment: security.md includes permission tiers and known risks.
- Execution evidence: sandbox-execution-evidence.json records rejected expired quote and incorrect PIN before one explicit approved payment. tools/export-sandbox-evidence.mjs reproduces it with synthetic data. agent-benchmark.json records live planning tests separately.
- GitHub repository: https://github.com/Adnanessoufi/FinMate (private). Grant organizer access if needed before submitting the link.
- Student study: study kit prepared, not conducted. Do not claim validation by real students yet.

## Eligibility and delivery

International Track teams have 2–5 full-time students at eligible institutions outside mainland China, Hong Kong, Macao and Taiwan. At least 60% must be non-Chinese nationals, rounded upward to whole people. Each person joins only one team across tracks. Register with truthful identification and enrollment information. English materials are required. Confirm your team's registration separately.

The current official website and IEEE announcement list fintechathon@ican-x.com. A university-distributed notice lists wangyr@pbcsf.tsinghua.edu.cn. Follow the recipient in your registration confirmation or obtain organizer clarification; never send passports to an unverified third party. Registration status and private organizer emails were not checked here. IEEE says confirmation should arrive within 48 hours and registration may close early.

Use 20 October 2026, 23:59 Beijing time as the safe deadline (17:59 Budapest). The website uses 24:00, while the PDF uses 23:59. Submit before the earlier time. Finalists are announced 31 October. Current website defence is 22 November and awards 23 November in Shenzhen. The circulated rules require at least one finalist team member to attend.

Sources: https://fintechathon.g-ican.com/#/en/rule ; https://www.ieee-cis-singapore.org/2026-fintechathon ; https://ird.oou.cmu.ac.th/2026-shenzhen-international-fintech-competition/ ; https://www.its.ac.id/international/wp-content/uploads/sites/66/2026/10/PBCSF-Appendix-2-Problem-Description-and-Competition-Rules-for-International-Track.pdf .

## Reviewer walkthrough

Run npm ci --ignore-scripts, npm test and npm start. Open the loopback URL. Use synthetic balances or your own manual planning inputs. Review setup, invoice, PIN and the complete tuition workflow. The assistant can read, compare, forecast and prepare, but cannot approve, execute, credit accounts, clear invoice changes or access credentials. All provider quotes and payments are simulated. In the workflow, each selected backup requires explicit user choice. Updated amounts and dates require fresh review.

Use the sample invoice for local extraction. Guardian is a consistency check, not university authentication. Expected income and private family-request estimates never count as actual received funds. ECB reference values are informational and do not change payment quote rates.
