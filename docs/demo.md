# Three-minute demonstration

## Before recording

Run `npm run dev`. Open the student profile and reset the session. If you have configured a provider, confirm the sidebar displays Live model; otherwise explicitly describe Offline planner mode. Keep Activity's execution export available after the final step.

## 0:00 - The student and the problem

Show the overview. Jamie has euro, pound and yuan balances. Tuition competes with rent and daily life. FinMate turns that context into an executable, constrained plan.

## 0:20 - Invoice to verified facts

Open Tuition → Upload an invoice. Upload the sample PDF. Show the extracted fields and source snippets. Confirm the recipient, account, amount and deadline. Explain that a document cannot authorize a payment.

## 0:50 - A meaningful decision

Open Sandbox studio and choose Deadline tomorrow. Return to Tuition. The cheaper bank wire is visibly ineligible because it arrives late. The recommended route meets the deadline and keeps EUR 2,030 protected for essentials and the emergency buffer.

Alternatively, ask the agent: “Plan my tuition using CNY.” Expand the tool trace to show account reading, comparison and preparation. It can prepare, never approve.

## 1:30 - Show the difficult case

Review the tuition plan. Expand Demonstrate quote protection and expire the quote. Confirm and try approval: the server blocks it. Get a fresh quote; the checkbox is reset and new approval is required.

## 2:00 - Approve and execute

Check the exact recipient, amount, fee and route. Approve. The sandbox produces one receipt, updates balances and protects the euro reserve. Repeated execution is idempotent; the automated test also sends two concurrent requests.

## 2:25 - Show the evidence

Open the audit trail. Show preparation, rejection, fresh approval and execution. Export the JSON evidence with linked hashes and receipts.

## 2:45 - Why students need it

Open Money plan and select A tougher month: yuan falls 5%, expected income is 14 days late and rent rises EUR 100. Show how the forecast changes and explain that these are explicit assumptions.

Close with: “FinMate helps international students pay across borders without losing control of the money they need to live.”

## Optional funding-gap demonstration

From a fresh demo, open Sandbox studio and choose Create a funding gap. The 5% CNY depreciation prevents any single CNY route from covering tuition. Tuition automatically opens the rescue section. Use GBP savings as a backup; the euro living reserve stays untouched. Uncheck GBP to show that preparation is blocked, then reselect it. Review both account debits and fees in one receipt, approve the whole payment once, and inspect the linked audit record. The agent also supports “Rescue my tuition using CNY.”

## Optional everyday purchase demonstration

Open Money Plan → Can I afford this? Try the EUR 180 weekend trip, then the EUR 1,400 laptop. Show the conservative spending limit and the before/after chart; expected scholarship payments are excluded. Select Try the spending limit to get a tight result. Enable Apply the stress-test values below and change currency depreciation or rent, then recheck. The assistant accepts “Can I afford a €180 weekend trip?” and opens the same purchase forecast. Show the planning audit record and explain that no funds were reserved or moved.

## Personalized semester demonstration

From Home choose Set up my plan. Review the profile and semester end, then monthly living costs, rent day and multiple income sources. Show that payment dates can differ and income can be in EUR, GBP or CNY. Review all tuition fields and confirm the setup; saving does not pay tuition or credit expected income.

The home screen now leads with the next dated decision and the saved monthly income total. Open Money Plan to inspect the full semester timeline and its expected-versus-conservative lowest balances. Ask the live assistant “Plan my semester and tell me my next decision.” Expand its `get_finances` and `plan_semester` trace. Return to Tuition when ready to compare routes and approve a fresh quote.
