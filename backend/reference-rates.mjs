import { fail } from './store.mjs';
export const REFERENCE_URL='https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml';
export const REFERENCE_PAGE='https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html';
// Public ECB observation, not a provider quote. Packaged for offline judging.
export const PACKAGED_REFERENCE={observationDate:'2026-10-09',perEUR:{EUR:1,GBP:0.84763,CNY:7.4992},retrievedAt:null};
export function parseReferenceXML(xml,now=Date.now()){
 if(typeof xml!=='string'||xml.length>100000||/<!DOCTYPE|<!ENTITY/i.test(xml))fail('REFERENCE_DATA','Invalid reference feed.');
 const observationDate=xml.match(/<Cube\s+time=['"](\d{4}-\d{2}-\d{2})['"]\s*>/)?.[1];
 if(!observationDate||new Date(observationDate+'T00:00:00Z').toISOString().slice(0,10)!==observationDate||Date.parse(observationDate)>now)fail('REFERENCE_DATA','Invalid reference observation date.');
 const perEUR={EUR:1};
 for(const currency of ['GBP','CNY']){
  const matches=[...xml.matchAll(new RegExp(`<Cube\\s+currency=['"]${currency}['"]\\s+rate=['"]([0-9]+(?:\\.[0-9]+)?)['"]\\s*\\/>`,'g'))];
  if(matches.length!==1)fail('REFERENCE_DATA','Incomplete or duplicate reference currency.');
  const rate=Number(matches[0][1]);if(!Number.isFinite(rate)||rate<=0||rate>10000)fail('REFERENCE_DATA','Invalid reference rate.');perEUR[currency]=rate;
 }
 return {observationDate,perEUR,retrievedAt:new Date(now).toISOString()};
}
export function referenceStatus(record,{now=Date.now(),connection='online',fallbackReason=null}={}){
 const ageDays=Math.max(0,Math.floor((Date.parse(new Date(now).toISOString().slice(0,10))-Date.parse(record.observationDate))/86400000));
 return {...structuredClone(record),source:'European Central Bank',sourceUrl:REFERENCE_PAGE,feedUrl:REFERENCE_URL,base:'EUR',ageDays,freshness:ageDays>4?'stale':'recent',connection,fallbackReason,informationalOnly:true,paymentQuotesSimulated:true};
}
export class ReferenceRates {
 constructor({fetchImpl=fetch,now=()=>Date.now(),ttl=3600000}={}){this.fetch=fetchImpl;this.now=now;this.ttl=ttl;this.record=structuredClone(PACKAGED_REFERENCE);this.checkedAt=null;this.connection='offline';this.pending=null;}
 async get(){
  if(this.pending)return this.pending;
  if(this.checkedAt!==null&&this.now()-this.checkedAt<this.ttl)return referenceStatus(this.record,{now:this.now(),connection:this.connection,fallbackReason:this.reason});
  this.pending=this.refresh();try{return await this.pending;}finally{this.pending=null;}
 }
 async refresh(){
  try{const response=await this.fetch(REFERENCE_URL,{signal:AbortSignal.timeout(5000),redirect:'error'});if(!response.ok)throw new Error('Feed unavailable');const declared=Number(response.headers?.get('content-length')||0);if(declared>100000)throw new Error('Oversized feed');const reader=response.body?.getReader();let xml='';if(reader){const decoder=new TextDecoder();let bytes=0;while(true){const r=await reader.read();if(r.done)break;bytes+=r.value.byteLength;if(bytes>100000){await reader.cancel();throw new Error('Oversized feed');}xml+=decoder.decode(r.value,{stream:true});}xml+=decoder.decode();}else xml=await response.text();const next=parseReferenceXML(xml,this.now());if(next.observationDate<this.record.observationDate)throw new Error('Older feed');this.record=next;this.connection='online';this.reason=null;}
  catch{this.connection='offline';this.reason='Feed unavailable or invalid. Showing the last validated reference observation.';}
  this.checkedAt=this.now();return referenceStatus(this.record,{now:this.now(),connection:this.connection,fallbackReason:this.reason});
 }
}
export const referenceRates=new ReferenceRates();
