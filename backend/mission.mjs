import { checkInvoice } from './guardian.mjs';
import { compareTuition, compareFunding, prepare, essentials, isoDay } from './engine.mjs';
import { digest, fail, round } from './store.mjs';
const currencies=['EUR','GBP','CNY'];
export function missionInput(input={}){
 const sourceCurrency=input.sourceCurrency??'CNY',backupCurrencies=input.backupCurrencies??[];
 if(!currencies.includes(sourceCurrency)||!Array.isArray(backupCurrencies)||backupCurrencies.length>2||backupCurrencies.some(c=>!currencies.includes(c)||c===sourceCurrency)||new Set(backupCurrencies).size!==backupCurrencies.length)fail('MISSION_INPUT','Choose one funding account and unique, explicit backup accounts.');
 const incomeDelay=input.incomeDelay??0;
 if(!Number.isInteger(incomeDelay)||incomeDelay<0||incomeDelay>60)fail('MISSION_INPUT','Expected income delay must be between 0 and 60 days.');
 return {sourceCurrency,backupCurrencies:[...backupCurrencies],incomeDelay};
}
export function tuitionMission(state,input={},now=Date.now()){
 const choices=missionInput(input),today=isoDay(now),guardian=checkInvoice(state);
 const protectedEUR=round(essentials(state)+state.budget.buffer),blockers=[];
 const snapshot={revision:state.revision,marketVersion:state.market.version,day:today,invoice:state.invoice,balances:state.balances,budget:state.budget,rates:state.market.rates,guardianDigest:guardian.checkDigest,origin:state.accounts?.origin??'sample',input:choices};
 const planDigest=digest(snapshot);
 if(state.invoice.paid)return {input:choices,planDigest,revision:state.revision,marketVersion:state.market.version,day:today,status:'paid',invoice:{...state.invoice},protectedEUR,blockers:[],alternatives:[],recommended:null,steps:[{id:'receipt',title:'Tuition already paid',reason:'Inspect the existing receipt in Activity. Do not prepare a second payment.',view:'activity'}],assumptions:['Payments settle immediately in the simulation. No real bank transfer was made.']};
 if(state.accounts?.origin!=='entered')blockers.push({id:'balances',title:'Enter your starting balances',reason:'Replace sample balances with your own planning snapshot. It is not bank verification.',action:'starting-balances'});
 if(!state.invoice.verified)blockers.push({id:'invoice',title:'Verify the tuition invoice',reason:'Check the recipient, account, amount, currency, reference and due date.',action:'current-invoice'});
 if(!guardian.canPlan)blockers.push({id:'guardian',title:'Review changed invoice details',reason:'Check differences independently through a university contact you trust.',action:'guardian-review'});
 let alternatives=[],recommended=null;
 if(state.invoice.verified&&guardian.canPlan){
  const singles=compareTuition(state,{sourceCurrency:choices.sourceCurrency},now).map(q=>({...q,type:'tuition'}));
  const combined=choices.backupCurrencies.length?compareFunding(state,choices,now).map(q=>({...q,type:'tuition-funding'})):[];
  alternatives=[...singles,...combined].sort((a,b)=>Number(b.eligible)-Number(a.eligible)||a.costEUR-b.costEUR||Number(a.type==='tuition-funding')-Number(b.type==='tuition-funding'));
  recommended=alternatives.find(q=>q.eligible)||null;
  if(!recommended)blockers.push({id:'funding',title:'No eligible payment with these accounts',reason:alternatives.map(q=>q.reasons.join('. ')).filter((s,i,a)=>s&&a.indexOf(s)===i).join(' / '),view:'tuition'});
 }
 const steps=[...blockers,{id:'income',title:choices.incomeDelay?'Treat delayed income as uncertain':'Keep expected income separate',reason:choices.incomeDelay?`Your ${choices.incomeDelay}-day delay is a planning assumption. Expected income is excluded from available payment funds.`:'Only current balances fund this payment. Scholarships and family support become spendable only after they arrive.',view:'plan'}];
 if(recommended)steps.push({id:'review',title:'Review the exact payment',reason:`${recommended.provider}, ${recommended.costEUR.toFixed(2)} EUR fees, arrival ${recommended.arrival}. ${recommended.remainingEUR.toFixed(2)} EUR remains against ${protectedEUR.toFixed(2)} EUR protected.`,action:'mission-prepare'});
 steps.push({id:'approval',title:'Approve separately with your payment PIN',reason:'Preparing a plan does not authorize it. A changed invoice, balance, budget or simulated rate requires fresh review.',action:'configure-pin'},{id:'receipt',title:'Inspect the receipt and audit',reason:'A successful sandbox payment is recorded once. Retries return the same receipt.',view:'activity'});
 return {input:choices,planDigest,revision:state.revision,marketVersion:state.market.version,day:today,status:blockers.length?'blocked':'ready',invoice:{...state.invoice},balances:{...state.balances},protectedEUR,blockers,alternatives,recommended,steps,assumptions:['Self-reported balances are not connected or bank-verified.','All provider rates, fees and payment execution are simulated.','Bank arrival estimates skip weekends but not local holidays.','Backups are used only when explicitly selected. EUR essentials and the saved buffer remain protected.','Reference exchange rates are informational and do not change payment quotes.'],availableIncome:0};
}
export function prepareMission(state,input,now=Date.now()){
 if(input.confirmed!==true)fail('MISSION_CONSENT','Review the current tuition plan and confirm before preparing a payment.',403);
 const plan=tuitionMission(state,input,now);
 if(input.planDigest!==plan.planDigest||input.baseRevision!==state.revision||input.marketVersion!==state.market.version)fail('MISSION_CHANGED','Your plan changed. Recalculate, review the differences and confirm again.',409);
 if(plan.status!=='ready'||!plan.recommended)fail('MISSION_BLOCKED','Complete the required checks before preparing tuition.',409);
 return prepare(state,{type:plan.recommended.type,sourceCurrency:plan.input.sourceCurrency,backupCurrencies:plan.input.backupCurrencies,route:plan.recommended.route},now);
}
