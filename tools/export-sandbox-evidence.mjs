import { randomInt } from 'node:crypto';
import { securityDefaults, setPaymentPin, approveWithPin } from '../backend/security.mjs';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { initialState, appendAudit, verifyAudit } from '../backend/store.mjs';
import { prepare, executeDraft } from '../backend/engine.mjs';
const now=Date.now(),state=initialState(now-120001),before={...state.balances};
const paymentPin=String(randomInt(100000,1000000)),session={state,csrf:'synthetic-evidence',security:securityDefaults()};
await setPaymentPin(session,{newPin:paymentPin,repeatPin:paymentPin,confirmed:true},now-120001);
const expired=prepare(state,{type:'tuition',sourceCurrency:'CNY'},now-120001);
try{await approveWithPin(session,{draftId:expired.id,digest:expired.digest,confirmed:true,pin:paymentPin},now);throw new Error('Expired approval was unexpectedly accepted.');}catch(error){if(error.code!=='QUOTE_EXPIRED')throw error;appendAudit(state,'Action blocked',error.message,{code:error.code,draftId:expired.id},now);}
const fresh=prepare(state,{type:'tuition',sourceCurrency:'CNY'},now);
try{await approveWithPin(session,{draftId:fresh.id,digest:fresh.digest,confirmed:true,pin:'not-the-pin'},now);throw new Error('Incorrect PIN was unexpectedly accepted.');}catch(error){if(error.code!=='PIN_INVALID')throw error;appendAudit(state,'Action blocked',error.message,{code:error.code,draftId:fresh.id},now);}
const approval=await approveWithPin(session,{draftId:fresh.id,digest:fresh.digest,confirmed:true,pin:paymentPin},now),receipt=executeDraft(state,approval,now);
const output={generatedAt:new Date(now).toISOString(),syntheticDataOnly:true,simulation:true,auditIntegrity:verifyAudit(state.audit),beforeBalances:before,afterBalances:state.balances,invoice:state.invoice,audit:state.audit,receipts:[receipt]};
await writeFile(resolve(import.meta.dirname,'../docs/sandbox-execution-evidence.json'),JSON.stringify(output,null,2));
console.log(JSON.stringify({auditIntegrity:output.auditIntegrity,receipts:output.receipts.length,expiredQuoteBlocked:true,incorrectPinBlocked:true,paymentPinRequired:true,simulation:true}));
