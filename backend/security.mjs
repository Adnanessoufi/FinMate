import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { fail, token, appendAudit } from './store.mjs';
import { approveDraft, validateDraft } from './engine.mjs';
const derive=promisify(scrypt);
const pinPattern=/^\d{6,12}$/;
export const safeEqual=(a,b)=>typeof a==='string'&&typeof b==='string'&&Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
export const securityDefaults=()=>({pin:null,failures:0,lockedUntil:0});
export function securityStatus(session,now=Date.now()){const s=session.security||securityDefaults();return {hasPin:!!s.pin,lockedUntil:s.lockedUntil>now?new Date(s.lockedUntil).toISOString():null,attemptsRemaining:s.lockedUntil&&s.lockedUntil<=now?5:Math.max(0,5-s.failures),paymentPinRequired:true};}
async function pinHash(pin,salt){return (await derive(pin,salt,32,{N:16384,r:8,p:1,maxmem:64*1024*1024})).toString('hex');}
async function verifyPaymentPin(session,pin,now){
 const s=session.security??=securityDefaults();
 if(!s.pin)fail('PIN_SETUP','Set a payment PIN before approving a payment.',403);
 if(s.lockedUntil>now)fail('PIN_LOCKED','Too many incorrect PIN attempts. Try again after the five-minute lockout.',429);
 if(s.lockedUntil){s.failures=0;s.lockedUntil=0;}
 const correct=typeof pin==='string'&&pinPattern.test(pin)&&safeEqual(await pinHash(pin,s.pin.salt),s.pin.hash);
 if(!correct){s.failures++;if(s.failures>=5)s.lockedUntil=now+5*60000;fail(s.lockedUntil?'PIN_LOCKED':'PIN_INVALID',s.lockedUntil?'Too many incorrect PIN attempts. Payments are locked for five minutes.':'The payment PIN is incorrect.',s.lockedUntil?429:403);}
 s.failures=0;s.lockedUntil=0;
}
export async function setPaymentPin(session,input,now=Date.now()){
 if(input.confirmed!==true||typeof input.newPin!=='string'||!pinPattern.test(input.newPin)||input.newPin!==input.repeatPin)fail('PIN_FORMAT','Choose and confirm a 6–12 digit payment PIN.',400);
 // Credential changes require the existing PIN; the model cannot reach this route.
 if(session.security?.pin)await verifyPaymentPin(session,input.currentPin,now);
 const salt=randomBytes(16).toString('hex'),hash=await pinHash(input.newPin,salt);
 session.security={pin:{salt,hash},failures:0,lockedUntil:0};session.csrf=token();
 session.state.revision++;
 for(const approval of Object.values(session.state.approvals))if(!approval.used)approval.revoked=true;
 appendAudit(session.state,'Payment PIN configured','PIN stored as a salted scrypt hash. Earlier payment quotes require fresh review; pending approvals are revoked.',{},now);
 return securityStatus(session,now);
}
export async function approveWithPin(session,input,now=Date.now()){
 if(input.confirmed!==true)fail('APPROVAL_REQUIRED','Explicit approval is required.',403);
 const draft=validateDraft(session.state,input.draftId,now);
 if(!safeEqual(input.digest,draft.digest))fail('PLAN_MISMATCH','Approval does not match the displayed plan.',409);
 await verifyPaymentPin(session,input.pin,now);
 return approveDraft(session.state,input,now);
}
export function validateToolArgs(args,schema){
 function check(value,s,depth=0){
  if(depth>8)return false;
  if(s.enum&&!s.enum.includes(value))return false;
  if(s.type==='object')return value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(k=>Object.hasOwn(s.properties||{},k)&&check(value[k],s.properties[k],depth+1))&&(s.required||[]).every(k=>Object.hasOwn(value,k));
  if(s.type==='array')return Array.isArray(value)&&(s.maxItems===undefined||value.length<=s.maxItems)&&value.every(v=>check(v,s.items,depth+1));
  if(s.type==='string')return typeof value==='string'&&(s.maxLength===undefined||value.length<=s.maxLength);
  if(s.type==='number'||s.type==='integer')return typeof value==='number'&&Number.isFinite(value)&&(s.type!=='integer'||Number.isInteger(value))&&(s.minimum===undefined||value>=s.minimum)&&(s.maximum===undefined||value<=s.maximum)&&(s.exclusiveMinimum===undefined||value>s.exclusiveMinimum);
  if(s.type==='boolean')return typeof value==='boolean';
  return false;
 }
 if(!check(args,schema)){if(schema.properties?.amount?.exclusiveMinimum===0&&typeof args?.amount==='number'&&args.amount<=0)fail('TOOL_ARGUMENTS','Use a positive amount within the permitted limits.');fail('TOOL_ARGUMENTS','Tool arguments do not match the permitted schema.');}
}
export class RateLimiter{
 constructor({limit=300,windowMs=60000,now=()=>Date.now()}={}){this.limit=limit;this.windowMs=windowMs;this.now=now;this.entries=new Map();}
 consume(key){const now=this.now();for(const [k,e] of this.entries)if(e.reset<=now)this.entries.delete(k);let e=this.entries.get(key);if(!e){if(this.entries.size>=4096)fail('RATE_LIMIT','The request limit is temporarily full. Retry shortly.',429);e={count:0,reset:now+this.windowMs};this.entries.set(key,e);}if(++e.count>this.limit){const error=new Error('Too many requests. Wait before trying again.');error.code='RATE_LIMIT';error.status=429;error.retryAfter=Math.ceil((e.reset-now)/1000);throw error;}}
}
export function validateJsonObject(input){let nodes=0;function check(v,depth){if(++nodes>5000||depth>8)fail('JSON_SHAPE','The JSON request is too complex.');if(v&&typeof v==='object'){for(const [key,value] of Object.entries(v)){if(['__proto__','prototype','constructor'].includes(key))fail('JSON_KEYS','Unsafe object keys are not accepted.');check(value,depth+1);}}}if(!input||typeof input!=='object'||Array.isArray(input))fail('JSON_OBJECT','Send a JSON object.');check(input,0);return input;}
