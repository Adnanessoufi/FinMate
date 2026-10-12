import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState,verifyAudit,Store} from '../backend/store.mjs';
import {compareTuition,compareFunding,prepare,approveDraft,executeDraft,total} from '../backend/engine.mjs';
import {runAgent} from '../backend/agent.mjs';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const NOW=Date.parse('2026-10-11T10:00:00Z');
const gap=()=>{const state=initialState(NOW);state.market.rates.CNY*=.95;return state;};
const approve=(state,draft)=>approveDraft(state,{draftId:draft.id,digest:draft.digest,confirmed:true},NOW);
const throws=(fn,code)=>assert.throws(fn,e=>e.code===code);

test('funding rescue covers a single-source shortfall with an explicitly selected backup',()=>{
 const state=gap();assert.ok(compareTuition(state,{},NOW).every(q=>!q.eligible));
 const plan=compareFunding(state,{sourceCurrency:'CNY',backupCurrencies:['GBP']},NOW)[0];
 assert.equal(plan.eligible,true);assert.deepEqual(plan.legs.map(l=>l.from),['CNY','GBP']);assert.equal(plan.received,2300);
 assert.ok(plan.primaryShortfall>0);assert.equal(plan.remainingEUR,2840);assert.equal(plan.protectedEUR,2030);
 for(const leg of plan.legs)assert.ok(leg.sourceAmount<=state.balances[leg.from]);
});
test('funding rescue never uses an unselected backup and reports the remaining gap',()=>{
 const state=gap(),before=structuredClone(state);
 const plans=compareFunding(state,{sourceCurrency:'CNY',backupCurrencies:[]},NOW);
 assert.ok(plans.every(p=>!p.eligible&&p.shortfall>0));assert.ok(plans.every(p=>p.legs.every(l=>l.from==='CNY')));
 throws(()=>prepare(state,{type:'tuition-funding',sourceCurrency:'CNY',backupCurrencies:[]},NOW),'NO_SAFE_FUNDING');assert.deepEqual(state,before);
});
test('funding routes must deliver every contribution by the tuition deadline',()=>{
 const state=gap();state.invoice.due='2026-10-12';const plans=compareFunding(state,{},NOW);
 assert.equal(plans[0].route,'student');assert.equal(plans[0].eligible,true);assert.equal(plans.find(p=>p.route==='bank').eligible,false);
 assert.ok(plans.find(p=>p.route==='bank').reasons.some(r=>r.includes('deadline')));
});
test('one approval executes all contributions and exactly one tuition payment',()=>{
 const state=gap(),before=total(state),draft=prepare(state,{type:'tuition-funding'},NOW),approval=approve(state,draft);
 const receipt=executeDraft(state,approval,NOW);assert.equal(state.invoice.paid,true);assert.equal(state.balances.EUR,2840);
 assert.deepEqual(state.balances,draft.quote.afterBalances);assert.ok(Math.abs(before-total(state)-2300-draft.quote.costEUR)<.02);
 assert.equal(state.transactions.filter(t=>t.category==='Tuition').length,1);assert.equal(receipt.quote.legs.length,2);assert.ok(verifyAudit(state.audit));
 const balances={...state.balances};const replay=executeDraft(state,approval,NOW+1);assert.equal(replay.id,receipt.id);assert.deepEqual(state.balances,balances);
});
test('a failing backup leaves the preferred account and all other balances untouched',()=>{
 const state=gap(),draft=prepare(state,{type:'tuition-funding'},NOW),approval=approve(state,draft);
 state.balances.GBP=0;const before={...state.balances};
 throws(()=>executeDraft(state,approval,NOW),'INSUFFICIENT_FUNDS');assert.deepEqual(state.balances,before);assert.equal(state.invoice.paid,false);assert.equal(state.approvals[approval.approvalId].used,false);
});
test('changed contribution instructions invalidate the digest-bound approval',()=>{
 const state=gap(),draft=prepare(state,{type:'tuition-funding'},NOW),approval=approve(state,draft),before={...state.balances};
 state.drafts[draft.id].quote.legs[1].sourceAmount+=1;
 throws(()=>executeDraft(state,approval,NOW),'PLAN_MISMATCH');assert.deepEqual(state.balances,before);
});
test('funding approvals expire and market changes invalidate the whole basket',()=>{
 const state=gap(),draft=prepare(state,{type:'tuition-funding'},NOW),approval=approve(state,draft);
 throws(()=>executeDraft(state,approval,NOW+120001),'QUOTE_EXPIRED');state.market.version++;
 throws(()=>executeDraft(state,approval,NOW),'QUOTE_CHANGED');assert.equal(state.invoice.paid,false);
});
test('spare euros are optional and the saved living reserve is always preserved',()=>{
 const state=gap();state.balances.GBP=0;
 const noEuros=compareFunding(state,{backupCurrencies:['GBP']},NOW);assert.ok(noEuros.every(p=>!p.eligible));
 const withEuros=compareFunding(state,{backupCurrencies:['EUR']},NOW).find(p=>p.eligible);assert.ok(withEuros);assert.ok(withEuros.remainingEUR>=2030);
 const draft=prepare(state,{type:'tuition-funding',backupCurrencies:['EUR']},NOW);executeDraft(state,approve(state,draft),NOW);assert.ok(state.balances.EUR>=2030);
 throws(()=>compareFunding(gap(),{buffer:0},NOW),'INPUT');
});
test('backup inputs, unverified invoices and already-paid invoices are rejected',()=>{
 for(const backupCurrencies of [['GBP','GBP'],['USD'],['CNY'],'GBP'])throws(()=>compareFunding(gap(),{backupCurrencies},NOW),'INPUT');
 const state=gap();state.invoice.verified=false;throws(()=>compareFunding(state,{},NOW),'INVOICE_UNVERIFIED');state.invoice.verified=true;state.invoice.paid=true;throws(()=>compareFunding(state,{},NOW),'ALREADY_PAID');
});
test('offline agent prepares a combined plan without gaining execution authority',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'finmate-funding-'));
 try{const store=await new Store(join(directory,'state.json')).init(),{id}=await store.create();store.sessions[id].state=gap();
 const result=await runAgent(store,id,'Rescue my tuition using CNY',{config:{mode:'offline'}});
 assert.equal(result.draft.type,'tuition-funding');assert.deepEqual(result.trace.map(t=>t.tool),['get_finances','compare_tuition','compare_funding','prepare_funding']);assert.match(result.answer,/One explicit approval/);assert.equal(store.sessions[id].state.invoice.paid,false);
 }finally{await rm(directory,{recursive:true,force:true});}
});
