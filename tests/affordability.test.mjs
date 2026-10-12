import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initialState, Store, verifyAudit } from '../backend/store.mjs';
import { affordability } from '../backend/affordability.mjs';
import { runAgent, dispatchTool } from '../backend/agent.mjs';
import { createApp } from '../server.mjs';
const NOW=Date.parse('2026-10-11T10:00:00Z');
const seed=()=>initialState(NOW);
const reject=fn=>assert.throws(fn,e=>e.code==='INPUT');

test('affordability distinguishes comfortable, tight and shortfall without changing accounts',()=>{
 const state=seed(),before=structuredClone(state);
 const comfortable=affordability(state,{amount:180},NOW),tight=affordability(state,{amount:810},NOW),large=affordability(state,{amount:1400},NOW);
 assert.equal(comfortable.status,'comfortable');assert.equal(tight.status,'tight');assert.equal(large.status,'shortfall');assert.equal(comfortable.maxAmount,810);assert.equal(comfortable.protectedEUR,2030);assert.equal(large.accountShortfall,590);assert.deepEqual(state,before);
});
test('purchase changes points only on and after its date, including today',()=>{
 const state=seed(),result=affordability(state,{amount:180,date:'2026-10-18'},NOW);
 assert.equal(result.baseline.points.length,61);assert.equal(result.proposed.points.length,61);
 for(let i=0;i<61;i++)assert.ok(Math.abs(result.baseline.points[i].balance-result.proposed.points[i].balance-(i<7?0:180))<.001);
 const today=affordability(state,{amount:180},NOW);assert.equal(today.baseline.points[0].balance-today.proposed.points[0].balance,180);
});
test('spending limit excludes uncertain scholarships and later-date suggestion is conditional',()=>{
 const result=affordability(seed(),{amount:1000,currency:'GBP'},NOW);
 assert.equal(result.status,'shortfall');assert.ok(result.minAfter<900);assert.ok(result.lowestExpected>=900);assert.equal(result.dependentOnIncome,true);assert.equal(result.suggestedDate,'2026-10-28');assert.match(result.suggestedDateCondition,/actually arrived/);
 assert.equal(result.baseline.points.at(-1).balance,result.expected.points.at(-1).balance+result.costEUR-1800);
});
test('combined wealth cannot replace funds in the selected paying account',()=>{
 const state=seed();state.balances.GBP=1;state.balances.EUR=5000;
 const result=affordability(state,{amount:180,currency:'GBP'},NOW);assert.equal(result.status,'shortfall');assert.equal(result.maxAmount,1);assert.equal(result.accountShortfall,179);assert.equal(result.dependentOnIncome,false);assert.equal(result.suggestedDate,null);
});
test('unverified tuition prevents a reliable limit and paid tuition is not counted twice',()=>{
 const state=seed(),before=affordability(state,{amount:500,currency:'GBP'},NOW);state.invoice.verified=false;
 const unverified=affordability(state,{amount:180},NOW);assert.equal(unverified.status,'verify');assert.equal(unverified.maxAmount,null);assert.ok(unverified.assumptions.some(a=>a.includes('Unverified')));
 state.invoice.paid=true;const after=affordability(state,{amount:500,currency:'GBP'},NOW);assert.ok(after.maxAmount>before.maxAmount);assert.ok(Math.abs(after.baseline.points.at(-1).balance-before.baseline.points.at(-1).balance-2300)<.001);
});
test('scenario costs, overdue tuition and existing shortfalls stay in the assessment',()=>{
 const state=seed(),base=affordability(state,{amount:180},NOW),stress=affordability(state,{amount:180,fxDrop:30,rentIncrease:100},NOW);
 assert.ok(stress.maxAmount<base.maxAmount);assert.ok(stress.minAfter<base.minAfter);
 state.invoice.due='2026-10-10';assert.ok(affordability(state,{amount:180},NOW).baseline.events.some(e=>e.type==='Overdue tuition'));
 state.balances={EUR:400,GBP:0,CNY:0};const poor=affordability(state,{amount:1,date:'2026-12-10'},NOW);assert.equal(poor.status,'shortfall');assert.equal(poor.maxAmount,0);
});
test('cent-safe limits preserve buffer across currencies and stress levels',()=>{
 for(const currency of ['EUR','GBP','CNY'])for(const fxDrop of [0,5,30])for(const date of ['2026-10-11','2026-11-01','2026-12-10']){
  const state=seed(),result=affordability(state,{amount:1,currency,fxDrop,date},NOW);
  if(result.maxAmount>0){const atLimit=affordability(state,{amount:result.maxAmount,currency,fxDrop,date},NOW);assert.notEqual(atLimit.status,'shortfall');assert.ok(atLimit.minAfter>=state.budget.buffer);const beyond=affordability(state,{amount:Math.round((result.maxAmount+.01)*100)/100,currency,fxDrop,date},NOW);assert.equal(beyond.status,'shortfall');}
 }
 const tiny=affordability(seed(),{amount:.01,currency:'CNY'},NOW);assert.equal(tiny.costEUR,.01);
});
test('invalid amounts, currencies, calendar dates, horizons and scenarios are rejected',()=>{
 for(const amount of [0,-1,Infinity,NaN,1.001,1000001,'180'])reject(()=>affordability(seed(),{amount},NOW));
 for(const date of ['2026-10-10','2026-12-11','2026-02-30','2026-13-01','tomorrow',null])reject(()=>affordability(seed(),{amount:180,date},NOW));
 for(const input of [{currency:'USD'},{currency:'__proto__'},{label:''},{label:'x'.repeat(101)},{fxDrop:31},{incomeDelay:1.2},{rentIncrease:-1}])reject(()=>affordability(seed(),{amount:180,...input},NOW));
});
test('offline assistant checks the purchase through tools, asks for missing inputs and never prepares payment',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'finmate-afford-agent-'));
 try{const store=await new Store(join(directory,'state.json')).init(),{id}=await store.create();store.sessions[id].state=seed();const balances={...store.sessions[id].state.balances};
  const result=await runAgent(store,id,'Can I afford a €180 weekend trip?',{now:NOW,config:{mode:'offline'}});assert.deepEqual(result.trace.map(t=>t.tool),['get_finances','check_affordability']);assert.equal(result.assessment.status,'comfortable');assert.equal(result.draft,null);assert.match(result.answer,/Conservative spending limit/);
  const gbp=await runAgent(store,id,'Can I afford a 1000 GBP trip?',{now:NOW,config:{mode:'offline'}});assert.equal(gbp.assessment.input.currency,'GBP');assert.equal(gbp.assessment.status,'shortfall');
  const missing=await runAgent(store,id,'Can I afford a trip?',{now:NOW,config:{mode:'offline'}});assert.equal(missing.assessment,null);assert.match(missing.answer,/amount and currency/);
  const bad=await runAgent(store,id,'Can I afford a -180 EUR trip?',{now:NOW,config:{mode:'offline'}});assert.equal(bad.assessment,null);assert.match(bad.answer,/positive amount/);
  await assert.rejects(()=>dispatchTool(store,id,'check_affordability',{amount:180,currency:'EUR',execute:true}),e=>e.code==='TOOL_ARGUMENTS');
  assert.deepEqual(store.sessions[id].state.balances,balances);assert.equal(Object.keys(store.sessions[id].state.drafts).length,0);
 }finally{await rm(directory,{recursive:true,force:true});}
});
test('live tool loop returns the structured affordability assessment',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'finmate-afford-live-'));
 try{const store=await new Store(join(directory,'state.json')).init(),{id}=await store.create();store.sessions[id].state=seed();let count=0;
 const replies=[{tool_calls:[{id:'1',type:'function',function:{name:'get_finances',arguments:'{}'}}]},{tool_calls:[{id:'2',type:'function',function:{name:'check_affordability',arguments:'{"amount":180,"currency":"EUR"}'}}]},{content:'This purchase fits your conservative spending limit.'}];
 const fetchImpl=async(_url,request)=>{const body=JSON.parse(request.body);if(count===2){const output=JSON.parse(body.messages.at(-1).content);assert.equal(output.status,'comfortable');assert.equal(output.maxAmount,810);}return {ok:true,json:async()=>({choices:[{message:replies[count++]}]})};};
 const result=await runAgent(store,id,'Can I afford this?',{now:NOW,config:{mode:'live',model:'fixture'},fetchImpl});assert.equal(result.assessment.status,'comfortable');assert.equal(result.draft,null);assert.equal(count,3);
 }finally{await rm(directory,{recursive:true,force:true});}
});
test('affordability API enforces CSRF and records planning evidence without moving funds',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'finmate-afford-http-'));let server;
 try{const app=await createApp({path:join(directory,'state.json')});server=app.server;await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
 const response=await fetch(base+'/api/bootstrap'),boot=await response.json(),cookie=response.headers.get('set-cookie').split(';')[0];
 const post=(input,token=boot.csrf)=>fetch(base+'/api/affordability',{method:'POST',headers:{'Content-Type':'application/json',Origin:base,Cookie:cookie,'X-FinMate-CSRF':token},body:JSON.stringify(input)});
 assert.equal((await post({amount:180},'bad')).status,403);const checked=await post({amount:180,label:'Weekend trip'});assert.equal(checked.status,200);assert.equal((await checked.json()).assessment.status,'comfortable');assert.equal((await post({amount:-1})).status,400);
 const state=(await(await fetch(base+'/api/state',{headers:{Cookie:cookie}})).json()).state;assert.deepEqual(state.balances,boot.state.balances);assert.equal(state.invoice.paid,false);assert.ok(state.audit.some(a=>a.title==='Affordability checked'));assert.ok(verifyAudit([...state.audit].reverse()));
 }finally{if(server)await new Promise(resolve=>server.close(resolve));await rm(directory,{recursive:true,force:true});}
});
