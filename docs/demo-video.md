# FinMate demo video

Existing video draft: `FinMate-demo-interactive.mp4`. The user has deferred further demo work; it precedes the latest desktop visual redesign and should be reviewed or re-recorded before final submission. This version uses an actual continuous browser recording, trimmed and retimed by chapter, with gentle zooms, English narration and burned-in captions. The earlier `FinMate-demo.mp4` is a screenshot-based walkthrough and is retained as an alternate.

The recorded interaction covers student setup and living reserves, invoice extraction and field confirmation, payment PIN setup, a deadline-aware route comparison, an actual live-agent plan and expanded tool trace, exact payment review, expired-quote rejection, fresh human approval, one simulated tuition receipt, audit inspection, purchase planning and currency conversion comparison. Only simulated tuition is executed; purchase and conversion comparisons do not move funds.

Recording used a separate encrypted journal, isolated cookie, and loopback server. A local recording page used the browser's screen-sharing picker and MediaRecorder. The user selected the capture target, after which the walkthrough was operated through the browser tools. Click rings are rendered by the recording helper and zooms are added in the edit. No UI values or receipts were fabricated. The captured browser viewport is narrow; the 1080p export preserves its proportions. Idle sections were removed and chapter speeds adjusted to match the narration.

Original browser accounts were preserved. No real funds moved, no credentials appear in the narration or video, and the video was not uploaded to a third-party service. The existing ElevenLabs narration from the first walkthrough is reused.

Local working files are in `demo-recording/`; earlier narration and captions are in `demo-video/`. Media and local capture journals are excluded from the source manifest. Code, tests, documentation and synthetic execution evidence remain in the source ZIP.
