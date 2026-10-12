import { fail, digest, appendAudit } from './store.mjs';
export const invoiceSnapshot=invoice=>Object.fromEntries(['id','recipient','account','reference','amount','currency','due'].map(k=>[k,invoice[k]]));
const norm=value=>String(value??'').normalize('NFKC').trim().toLowerCase().replace(/\s+/g,' ');
export const accountKey=value=>norm(value).replace(/[\s-]/g,'');
export const referenceKey=norm;
export function guardianDefaults(invoice){return {baseline:invoice.verified?invoiceSnapshot(invoice):null,history:invoice.verified?[invoiceSnapshot(invoice)]:[],review:null};}
export function checkInvoice(state,candidate=state.invoice){
 const saved=state.guardian||guardianDefaults(state.invoice),baseline=saved.baseline,flags=[];
 const flag=(code,label,before,after)=>flags.push({code,label,before,after});
 if(!baseline)flag('FIRST_RECIPIENT','No previous recipient to compare',null,candidate.recipient);
 else {
  if(norm(candidate.recipient)!==norm(baseline.recipient))flag('RECIPIENT_CHANGED','Recipient changed',baseline.recipient,candidate.recipient);
  if(accountKey(candidate.account)!==accountKey(baseline.account))flag('ACCOUNT_CHANGED','Recipient account changed',baseline.account,candidate.account);
  if(candidate.currency!==baseline.currency)flag('CURRENCY_CHANGED','Invoice currency changed',baseline.currency,candidate.currency);
  if(candidate.amount!==baseline.amount)flag('AMOUNT_CHANGED','Tuition amount changed',baseline.amount,candidate.amount);
 }
 const paid=state.audit.some(a=>a.details.invoiceReference&&referenceKey(a.details.invoiceReference)===referenceKey(candidate.reference));
 if(paid&&!candidate.paid)flag('PAID_REFERENCE','Reference already paid',candidate.reference,candidate.reference);
 const reused=(saved.history||[]).some(i=>i.id!==candidate.id&&referenceKey(i.reference)===referenceKey(candidate.reference));
 if(reused&&!paid)flag('REFERENCE_REUSED','Reference used by an earlier invoice',candidate.reference,candidate.reference);
 const checkDigest=digest({invoice:invoiceSnapshot(candidate),baseline,flags});
 const reviewed=saved.review?.invoiceId===candidate.id&&saved.review?.checkDigest===checkDigest;
 const blocked=flags.some(f=>f.code==='PAID_REFERENCE');
 return {invoiceId:candidate.id,revision:state.revision,checkDigest,baseline,flags,status:blocked?'blocked':flags.length?(reviewed?'reviewed':'review-required'):'clear',canPlan:!blocked&&(!flags.length||reviewed),review:reviewed?saved.review:null,limitation:'Compares your previously reviewed details. It does not authenticate a university or detect every fraudulent invoice.'};
}
export function assertInvoiceSafe(state){const check=checkInvoice(state);if(!check.canPlan)fail('GUARDIAN_REVIEW',check.status==='blocked'?'This invoice reference has already been paid. Check the original receipt.':'Tuition Guardian found changed or reused details. Review them separately before planning a payment.',409);}
export function reviewInvoiceChanges(state,input,now=Date.now()){
 const check=checkInvoice(state);
 if(input.confirmed!==true)fail('GUARDIAN_CONFIRM','Confirm that you checked these changes through a university contact you already trust.',403);
 if(input.baseRevision!==state.revision||input.checkDigest!==check.checkDigest||input.invoiceId!==state.invoice.id)fail('STATE_CHANGED','The invoice or comparison changed. Reload and review the current details.',409);
 if(check.status==='blocked')fail('ALREADY_PAID','A paid invoice reference cannot be cleared for another payment.',409);
 if(!check.flags.length||check.status==='reviewed')fail('GUARDIAN_CLEAR','This invoice does not need another change review.');
 const methods=['university-portal','known-contact','in-person'];
 if(!methods.includes(input.method)||typeof input.note!=='string'||input.note.trim().length<8||input.note.length>240)fail('GUARDIAN_EVIDENCE','Choose how you checked the changes and record a short note (8–240 characters).');
 state.guardian??=guardianDefaults(state.invoice);
 state.guardian.review={invoiceId:state.invoice.id,checkDigest:check.checkDigest,method:input.method,note:input.note.trim(),reviewedAt:new Date(now).toISOString()};state.revision++;
 appendAudit(state,'Tuition changes reviewed','The user separately reviewed invoice differences. Payment still requires approval.',{invoiceId:state.invoice.id,changes:check.flags,method:input.method,note:input.note.trim()},now);
 return checkInvoice(state);
}
