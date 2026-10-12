import { assertInvoiceSafe } from './guardian.mjs';
import { fail, round, digest, token, appendAudit } from './store.mjs';
import { randomUUID, timingSafeEqual } from 'node:crypto';
const sameHash=(a,b)=>typeof a==='string'&&typeof b==='string'&&/^[a-f0-9]{64}$/.test(a)&&/^[a-f0-9]{64}$/.test(b)&&timingSafeEqual(Buffer.from(a,'hex'),Buffer.from(b,'hex'));
export const ROUTES=[{id:'student',name:'Student transfer',feeRate:.006,days:1},{id:'bank',name:'Bank wire',feeRate:.003,days:5},{id:'instant',name:'Instant conversion',feeRate:.018,days:0}];
export const validCurrency=c=>['EUR','GBP','CNY'].includes(c);
export const validAmount=n=>Number.isFinite(n)&&n>=.01&&n<=1000000&&Math.abs(n*100-Math.round(n*100))<.00001;
export function isoDay(now=Date.now()){return new Date(now).toISOString().slice(0,10);}
export function businessArrival(now,days){const date=new Date(now);while(days>0){date.setUTCDate(date.getUTCDate()+1);if(![0,6].includes(date.getUTCDay()))days--;}return date.toISOString().slice(0,10);}
export function essentials(state){return Object.entries(state.budget).filter(([key])=>key!=='buffer').reduce((sum,[,n])=>sum+n,0);}
export function total(state,rates=state.market.rates){return round(Object.entries(state.balances).reduce((n,[c,a])=>n+a*rates[c],0));}
function sourceQuote(state,amount,from,to,route,now){if(!validAmount(amount)||!validCurrency(from)||!validCurrency(to)||from===to)fail('INPUT','Enter a valid amount and two different supported currencies.');const rate=state.market.rates[from]/state.market.rates[to],fee=round(amount*route.feeRate);if(round((amount-fee)*rate)<.01)fail('MIN_RECEIVED','Increase the amount so at least one cent arrives.');return {sourceAmount:amount,from,to,fee,received:round((amount-fee)*rate),rate,provider:route.name,route:route.id,arrival:businessArrival(now,route.days),costEUR:round(fee*state.market.rates[from])};}
export function compareTransfers(state,{amount,from,to},now=Date.now()){return ROUTES.map(r=>({...sourceQuote(state,amount,from,to,r,now),sufficient:amount<=state.balances[from],source:'Simulated provider quote',asOf:new Date(now).toISOString()}));}
export function compareTuition(state,{sourceCurrency='CNY',buffer=state.budget.buffer}={},now=Date.now()){
  if(!validCurrency(sourceCurrency)||!Number.isFinite(buffer)||buffer<state.budget.buffer||buffer>100000)fail('INPUT','The buffer must be at least your saved emergency reserve.');
  const invoice=state.invoice;
  if(!invoice.verified)fail('INVOICE_UNVERIFIED','Verify the invoice details before planning a payment.');
  if(invoice.paid)fail('ALREADY_PAID','This invoice has already been paid.',409);
  assertInvoiceSafe(state);
  const protectedEUR=round(essentials(state)+buffer);
  const routes=sourceCurrency===invoice.currency?[{id:'direct',name:'Direct account payment',feeRate:0,days:1}]:ROUTES;
  return routes.map(route=>{
    const rate=state.market.rates[sourceCurrency]/state.market.rates[invoice.currency];
    let amount=Math.ceil(invoice.amount/rate/(1-route.feeRate)*100)/100;
    let fee=round(amount*route.feeRate),received=round((amount-fee)*rate);
    while(received<invoice.amount){amount=round(amount+.01);fee=round(amount*route.feeRate);received=round((amount-fee)*rate);}
    const arrival=businessArrival(now,route.days),remainingEUR=round(state.balances.EUR-(sourceCurrency==='EUR'?amount:0)+(invoice.currency==='EUR'?received-invoice.amount:0));
    const reasons=[];
    if(amount>state.balances[sourceCurrency])reasons.push('Insufficient source balance');
    if(arrival>invoice.due)reasons.push('Arrives after tuition deadline');
    if(remainingEUR<protectedEUR)reasons.push('Would use protected living costs or emergency buffer');
    return {sourceAmount:amount,from:sourceCurrency,to:invoice.currency,fee,received,rate,provider:route.name,route:route.id,arrival,costEUR:round(fee*state.market.rates[sourceCurrency]),remainingEUR,protectedEUR,eligible:!reasons.length,reasons,source:'Simulated provider quote',asOf:new Date(now).toISOString()};
  }).sort((a,b)=>Number(b.eligible)-Number(a.eligible)||a.costEUR-b.costEUR);
}
// Use the preferred account first, then only the explicitly selected backups.
// Source debits are searched in integer cents to avoid underfunding the invoice.
export function compareFunding(state,{sourceCurrency='CNY',backupCurrencies,buffer=state.budget.buffer}={},now=Date.now()){
  if(!validCurrency(sourceCurrency)||!Number.isFinite(buffer)||buffer<state.budget.buffer||buffer>100000)fail('INPUT','Choose a valid source and preserve the saved emergency buffer.');
  const backups=backupCurrencies??['CNY','GBP'].filter(c=>c!==sourceCurrency);
  if(!Array.isArray(backups)||backups.length>2||backups.some(c=>!validCurrency(c)||c===sourceCurrency)||new Set(backups).size!==backups.length)fail('INPUT','Choose unique backup currencies different from the preferred account.');
  const invoice=state.invoice;
  if(!invoice.verified)fail('INVOICE_UNVERIFIED','Verify the invoice before combining accounts.');
  if(invoice.paid)fail('ALREADY_PAID','This invoice has already been paid.',409);
  assertInvoiceSafe(state);
  const protectedEUR=round(essentials(state)+buffer),order=[sourceCurrency,...backups];
  return ROUTES.map(route=>{
    let remaining=invoice.amount;const legs=[];
    for(const from of order){
      if(remaining<=0)break;
      const capacity=Math.max(0,Math.floor((state.balances[from]-(from==='EUR'?protectedEUR:0)+.000001)*100));
      if(!capacity)continue;
      const direct=from===invoice.currency,rate=state.market.rates[from]/state.market.rates[invoice.currency];
      const received=cents=>round((cents/100-(direct?0:round(cents/100*route.feeRate)))*rate);
      const target=Math.min(remaining,received(capacity));if(target<.01)continue;
      let low=1,high=capacity;while(low<high){const mid=Math.floor((low+high)/2);if(received(mid)>=target)high=mid;else low=mid+1;}
      const amount=low/100,fee=direct?0:round(amount*route.feeRate);
      const leg={from,to:invoice.currency,sourceAmount:amount,received:received(low),fee,rate,provider:direct?'Direct account payment':route.name,route:direct?'direct':route.id,arrival:businessArrival(now,direct?1:route.days),costEUR:round(fee*state.market.rates[from])};
      legs.push(leg);remaining=round(remaining-leg.received);
    }
    const after={...state.balances};for(const leg of legs){after[leg.from]=round(after[leg.from]-leg.sourceAmount);after[leg.to]=round(after[leg.to]+leg.received);}after[invoice.currency]=round(after[invoice.currency]-invoice.amount);
    const arrival=legs.reduce((date,leg)=>leg.arrival>date?leg.arrival:date,isoDay(now));
    const shortfall=Math.max(0,remaining),reasons=[];
    if(shortfall>0)reasons.push(`Selected accounts are short by ${shortfall.toFixed(2)} ${invoice.currency}`);
    if(arrival>invoice.due)reasons.push('One or more contributions arrive after the deadline');
    if(after.EUR<protectedEUR)reasons.push('Would spend protected euro living funds');
    return {route:route.id,provider:route.name,to:invoice.currency,legs,sourceCurrency,backupCurrencies:[...backups],arrival,received:round(legs.reduce((n,l)=>n+l.received,0)),costEUR:round(legs.reduce((n,l)=>n+l.costEUR,0)),protectedEUR,remainingEUR:after.EUR,afterBalances:after,shortfall,primaryShortfall:Math.max(0,round(invoice.amount-(legs.find(l=>l.from===sourceCurrency)?.received||0))),eligible:!reasons.length,reasons,source:'Simulated provider quotes',asOf:new Date(now).toISOString()};
  }).sort((a,b)=>Number(b.eligible)-Number(a.eligible)||a.costEUR-b.costEUR);
}
export function prepare(state,input,now=Date.now()){
  let q,invoice=null;
  if(input.type==='tuition-funding'){
    const choices=compareFunding(state,input,now);q=input.route?choices.find(q=>q.route===input.route):choices.find(q=>q.eligible);
    if(!q||!q.eligible)fail('NO_SAFE_FUNDING',q?.reasons.join('. ')||'Selected accounts cannot cover tuition before the deadline without using protected funds.');invoice=structuredClone(state.invoice);
  }else if(input.type==='tuition'){
    const choices=compareTuition(state,input,now);q=input.route?choices.find(q=>q.route===input.route):choices.find(q=>q.eligible);
    if(!q||!q.eligible)fail('NO_SAFE_ROUTE',q?.reasons.join('. ')||'No route meets the deadline, balances and living-cost protection.');invoice=structuredClone(state.invoice);
  }else if(input.type==='transfer'){
    q=compareTransfers(state,input,now).find(q=>q.route===(input.route||'student'));
    if(!q||!q.sufficient)fail('INSUFFICIENT_FUNDS','Your source account does not have enough funds.');
  }else fail('INPUT','Choose a supported action.');
  const draft={id:randomUUID(),type:input.type,quote:q,invoice,revision:state.revision,marketVersion:state.market.version,createdAt:new Date(now).toISOString(),expiresAt:new Date(now+120000).toISOString()};draft.digest=digest(draft);state.drafts[draft.id]={...draft,status:'prepared'};
  appendAudit(state,'Payment plan prepared',q.legs?`${q.legs.length} account contributions via ${q.provider}. Waiting for one explicit approval.`:`${q.provider}: ${q.sourceAmount} ${q.from}. Waiting for explicit approval.`,{draftId:draft.id,digest:draft.digest,expiresAt:draft.expiresAt},now);return draft;
}
export function validateDraft(state,id,now=Date.now()){const draft=typeof id==='string'&&Object.hasOwn(state.drafts,id)?state.drafts[id]:null;if(!draft)fail('NOT_FOUND','Payment plan not found.',404);if(Date.parse(draft.expiresAt)<=now)fail('QUOTE_EXPIRED','This quote has expired. Refresh the plan and approve the new quote.',409);if(draft.marketVersion!==state.market.version)fail('QUOTE_CHANGED','Rates changed. Refresh the plan and review the new amounts.',409);if(draft.revision!==state.revision)fail('STATE_CHANGED','Your accounts or invoice changed. Refresh the plan.',409);const {digest:storedDigest,status,...immutable}=draft;if(digest(immutable)!==storedDigest)fail('PLAN_MISMATCH','The saved plan no longer matches its approved contents.',409);return draft;}
export function approveDraft(state,{draftId,digest:approvedDigest,confirmed},now=Date.now()){
  if(confirmed!==true)fail('APPROVAL_REQUIRED','Explicit approval is required.',403);
  const draft=validateDraft(state,draftId,now);if(draft.type!=='transfer')assertInvoiceSafe(state);if(approvedDigest!==draft.digest)fail('PLAN_MISMATCH','Approval does not match the displayed plan.',409);
  if(draft.status!=='prepared')fail('APPROVAL_EXISTS','This plan has already been approved or executed.',409);
  const secret=token(),id=randomUUID();state.approvals[id]={id,draftId,digest:draft.digest,tokenHash:digest(secret),used:false};draft.status='approved';
  appendAudit(state,'Payment explicitly approved','Approval is bound to the displayed recipient, amount, fee, rate and deadline.',{approvalId:id,draftId,digest:draft.digest},now);return {approvalId:id,token:secret,draftId};
}
export function executeDraft(state,{draftId,approvalId,token:secret},now=Date.now()){
  const approval=typeof approvalId==='string'&&Object.hasOwn(state.approvals,approvalId)?state.approvals[approvalId]:null;
  if(!approval||approval.revoked||approval.draftId!==draftId||typeof secret!=='string'||! /^[a-f0-9]{64}$/.test(secret)||!sameHash(digest(secret),approval.tokenHash))fail('APPROVAL_REQUIRED','A matching approval token is required.',403);
  if(approval.used)return {...approval.receipt,replayed:true};
  const draft=validateDraft(state,draftId,now);
  if(approval.digest!==draft.digest||draft.status!=='approved')fail('PLAN_MISMATCH','This approval does not match the payment plan.',409);
  const q=draft.quote,legs=q.legs||[q],isTuition=draft.type!=='transfer';let next={...state.balances};
  if(isTuition){
    assertInvoiceSafe(state);
    if(state.invoice.paid)fail('ALREADY_PAID','This invoice has already been paid.',409);
    if(digest(state.invoice)!==digest(draft.invoice))fail('INVOICE_CHANGED','Invoice details changed. Prepare and approve a new plan.',409);
  }
  // Calculate every debit and credit before committing any account mutation.
  for(const leg of legs){
    if(next[leg.from]<leg.sourceAmount)fail('INSUFFICIENT_FUNDS','A source account no longer has enough funds. Nothing was debited.',409);
    next[leg.from]=round(next[leg.from]-leg.sourceAmount);next[leg.to]=round(next[leg.to]+leg.received);
  }
  if(isTuition){next[state.invoice.currency]=round(next[state.invoice.currency]-state.invoice.amount);if(next.EUR<q.protectedEUR)fail('BUDGET_PROTECTED','Payment would spend protected living funds.',409);}
  state.balances=next;state.revision++;
  const date=isoDay(now),newTransaction=(description,amount,currency,category)=>({id:randomUUID(),date,description,amount,currency,category});
  for(const leg of legs){if(leg.from!==leg.to)state.transactions.unshift(newTransaction(`Conversion via ${leg.provider}`,-leg.sourceAmount,leg.from,'Currency transfer'),newTransaction(`From your ${leg.from} account`,leg.received,leg.to,'Currency transfer'));}
  if(isTuition){state.invoice.paid=true;state.tuitionPaid=true;state.transactions.unshift(newTransaction(state.invoice.recipient,-state.invoice.amount,state.invoice.currency,'Tuition'));}
  const entry=appendAudit(state,isTuition?'Tuition paid in sandbox':'Transfer executed in sandbox',q.legs?'All account contributions and tuition executed atomically after one matching approval.':'Executed once after explicit, matching approval.',{draftId,approvalId,digest:draft.digest,quote:q,invoiceReference:draft.invoice?.reference.toLowerCase(),invoiceAccount:draft.invoice?.account.toLowerCase(),recipient:draft.invoice?.recipient||`Your ${q.to} account`},now);
  const receipt={id:randomUUID(),draftId,approvalId,auditId:entry.id,auditHash:entry.hash,executedAt:new Date(now).toISOString(),type:draft.type,quote:q,invoiceReference:draft.invoice?.reference.toLowerCase(),invoiceAccount:draft.invoice?.account.toLowerCase(),recipient:draft.invoice?.recipient||`Your ${q.to} account`,status:'completed',simulation:true};
  approval.used=true;approval.receipt=receipt;draft.status='executed';return receipt;
}
