# New continuous desktop demo

Target duration: approximately 3 minutes 35 seconds, always below 5 minutes. English narration. Continuous browser capture with actual clicks, scrolling and page changes, then gentle zooms and chapter captions. Do not substitute screenshot slides for the walkthrough.

Use http://localhost:52927/record after running node tools/serve-review.mjs. It has an isolated synthetic account and cookie. Start recording and choose this recorder tab in the browser sharing picker. Keep the browser panel expanded enough to show the desktop layout. No application credentials or real personal information belong in the capture.

Sequence: Home and entered balances; verified invoice and Guardian; CNY-only shortfall with a 14-day income-delay assumption; explicitly permit GBP and rebuild; exact payment review; quote-expiry rejection and fresh review; incorrect synthetic PIN rejection, then explicit sandbox approval; receipt and audit; Chinese affordability question; source-dated ECB reference. Use the narration in demo-script.json.

The recorder saves browser video chunks locally so long idle download tails are avoided. Capture cannot begin until a person selects a browser surface in the system sharing picker. Check the saved frame size, narration timing, audible speech, video decode and the 5-minute limit before submission. The old videos predate the new desktop design and should not be used as the final demo.
