import { checkInvoice } from './guardian.mjs';
import { round } from './store.mjs';
import { isoDay, essentials, compareTuition, compareFunding } from './engine.mjs';
import { forecast } from './forecast.mjs';
import { studentSettings } from './student.mjs';
function beforeBusinessDays(day,count){const date=new Date(day+'T12:00:00Z');while(count>0){date.setUTCDate(date.getUTCDate()-1);if(![0,6].includes(date.getUTCDay()))count--;}return isoDay(date);}
export function semesterPlan(state,input={},now=Date.now()){
 const {profile}=studentSettings(state),today=isoDay(now),expired=profile.semesterEnd<=today;
 const days=Math.max(1,Math.min(180,Math.ceil((Date.parse(profile.semesterEnd)-Date.parse(today))/86400000)));
 const projection=forecast(state,{days},now),events=projection.events,actions=[];
 const add=(id,date,title,reason,view,priority=2,extra={})=>actions.push({id,date:date<today?today:date,title,reason,view,priority,...extra});
 const reserve=round(essentials(state)+state.budget.buffer),reserveGap=Math.max(0,round(reserve-state.balances.EUR));
 const conservative=projection.points.map(p=>({...p,balance:round(p.balance-events.filter(e=>e.uncertain&&e.date<=p.date).reduce((sum,e)=>sum+e.amount,0))}));
 const conservativeMin=Math.min(...conservative.map(p=>p.balance));
 if(!profile.setupComplete||expired)add('setup',today,expired?'Set your next semester dates':'Make this plan yours',expired?'Your semester end has passed. Update the dates before relying on the plan.':'Review your profile, monthly income, tuition and living budget.','setup',-2);
 if(!state.invoice.paid&&!state.invoice.verified)add('verify-invoice',today,'Verify your tuition invoice','Unverified tuition is excluded from the forecast. Review the recipient, account, amount and date.','tuition',-1);
 if(reserveGap>0)add('living-reserve',today,'Top up your living reserve',`Your euro account is ${reserveGap.toFixed(2)} EUR below ${reserve.toFixed(2)} EUR of monthly essentials and buffer. Compare a conversion before relying on combined funds.`,'transfers',0);
 const guardian=checkInvoice(state);
 if(!state.invoice.paid&&!guardian.canPlan)add('guardian-review',today,'Check the tuition changes','Tuition Guardian found differences or a reused reference. Review them before comparing or preparing payments.','tuition',-1);
 let tuition=null;
 if(!state.invoice.paid&&state.invoice.verified&&guardian.canPlan&&state.invoice.due<=projection.points.at(-1).date){
  const sourceCurrency=profile.homeCurrency,backups=['CNY','GBP'].filter(c=>c!==sourceCurrency);
  const routes=compareTuition(state,{sourceCurrency},now),single=routes.find(r=>r.eligible);
  const basket=single?null:compareFunding(state,{sourceCurrency,backupCurrencies:backups},now).find(r=>r.eligible);
  const best=single||basket;
  const routeDays={student:1,bank:5,instant:0,direct:1};
  const reviewDate=best?beforeBusinessDays(state.invoice.due,(routeDays[best.route]??1)+1):today;
  tuition={sourceCurrency,eligible:!!best,combined:!!basket,provider:best?.provider||null,costEUR:best?.costEUR??null,reviewDate:reviewDate<today?today:reviewDate,due:state.invoice.due,amount:state.invoice.amount,currency:state.invoice.currency};
  add('tuition-review',tuition.reviewDate,best?'Review your tuition payment':'Arrange tuition funding',best?`${best.provider}${basket?' with potential backup savings':''} is currently eligible. Estimated fees ${best.costEUR.toFixed(2)} EUR; tuition ${state.invoice.amount.toFixed(2)} ${state.invoice.currency} is due ${state.invoice.due}. Get a fresh quote and approve before paying.`:'No current route covers the deadline and reserve. Review funding options before committing.', 'tuition',best?1:0,{tuition:true});
 }
 if(projection.firstBreach){const date=new Date(projection.firstBreach+'T12:00:00Z');date.setUTCDate(date.getUTCDate()-7);add('cash-shortfall',isoDay(date),'Arrange support before a shortfall',`Even including expected income, your combined balance crosses the buffer on ${projection.firstBreach}. Revisit spending or arrange additional funding.`,'plan',0);}
 for(const event of events){
  if(event.type==='Rent')add('rent-'+event.date,event.date,'Keep rent ready',`${Math.abs(event.amount).toFixed(2)} EUR is budgeted for rent. Check your paying account; this plan does not schedule a payment.`,'plan',2,{amount:event.amount});
  if(event.uncertain)add('income-'+event.incomeId+'-'+event.date,event.date,`Check ${event.type.replace(/^Expected /,'')}`,`Expected ${event.sourceAmount.toFixed(2)} ${event.sourceCurrency}. Confirm it has arrived in your account before counting it as spendable. Forecast entries never credit balances.`,'activity',3,{income:true,amount:event.amount});
 }
 actions.sort((a,b)=>a.date.localeCompare(b.date)||a.priority-b.priority||a.id.localeCompare(b.id));
 const next=actions.find(a=>a.priority<=1)||actions[0]||{date:today,title:'Your semester is up to date',reason:'Review your budget and upcoming commitments when plans change.',view:'plan'};
 return {revision:state.revision,marketVersion:state.market.version,today,end:projection.points.at(-1).date,days,expired,profile,projection,conservativeMin,protectedEUR:reserve,reserveGap,tuition,actions,next,assumptions:['Expected income is an estimate and never changes balances.','Amounts and rates are simulated. A plan does not reserve funds or schedule payments.','Only the saved tuition invoice and recurring budget are included; add other commitments to your budget.','Route eligibility is checked now. Review dates allow an extra business day; refresh quotes before approving.','Business-day estimates skip weekends; bank holidays are not modeled.']};
}
