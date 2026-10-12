import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,rename,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {Store} from '../backend/store.mjs';
import {runAgent} from '../backend/agent.mjs';
async function cleanup(directory){assert.equal(dirname(resolve(directory)),resolve(tmpdir()));await rm(directory,{recursive:true,force:true});}
test('transient file locks retry atomic replacement without losing saved settings',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'finmate-lock-'));try{let attempts=0;const store=await new Store(join(directory,'state.json'),{replaceFile:async(...args)=>{if(++attempts<3)throw Object.assign(new Error('Temporary file lock'),{code:'EACCES'});return rename(...args);}}).init();const {id}=await store.create();assert.equal(attempts,3);await store.mutate(id,s=>{s.state.profile.name='Saved student';});const restored=await new Store(store.path).init();assert.equal(restored.sessions[id].state.profile.name,'Saved student');}finally{await cleanup(directory);}
});
test('permanent storage failure rolls back account mutations and preserves prior evidence',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'finmate-write-fail-'));try{const store=await new Store(join(directory,'state.json')).init(),{id}=await store.create(),before=await readFile(store.path,'utf8');let attempts=0;store.replaceFile=async()=>{attempts++;throw Object.assign(new Error('Unavailable storage'),{code:'EPERM'});};const balance=store.sessions[id].state.balances.EUR;await assert.rejects(()=>store.mutate(id,s=>{s.state.balances.EUR=0;}),e=>e.code==='EPERM');assert.equal(attempts,5);assert.equal(store.sessions[id].state.balances.EUR,balance);assert.equal(await readFile(store.path,'utf8'),before);}finally{await cleanup(directory);}
});
test('live next-decision requests enforce a dated semester tool after reading finances',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'finmate-next-decision-'));try{const store=await new Store(join(directory,'state.json')).init(),{id}=await store.create();let iteration=0;const replies=[{tool_calls:[{id:'1',type:'function',function:{name:'get_finances',arguments:'{}'}}]},{tool_calls:[{id:'2',type:'function',function:{name:'plan_semester',arguments:'{}'}}]},{content:'Review your saved semester actions before paying.'}];const fetchImpl=async(_url,request)=>{const body=JSON.parse(request.body);if(iteration===1)assert.equal(body.tool_choice.function.name,'plan_semester');assert.equal(body.reasoning_effort,'none');return {ok:true,json:async()=>({choices:[{message:replies[iteration++]}]})};};const result=await runAgent(store,id,'What is my next semester decision?',{config:{mode:'live',model:'gpt-5.6-terra'},fetchImpl});assert.ok(result.semester);assert.deepEqual(result.trace.map(t=>t.tool),['get_finances','plan_semester']);assert.equal(result.draft,null);}finally{await cleanup(directory);}
});
