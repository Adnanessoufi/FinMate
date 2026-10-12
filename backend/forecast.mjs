import { fail, round } from './store.mjs';
import { total, essentials, isoDay } from './engine.mjs';
import { studentSettings } from './student.mjs';
export const monthDay=(date,day)=>Math.min(day,new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+1,0)).getUTCDate());
export function forecast(state,input={},now=Date.now()){
 const {fxDrop=0,incomeDelay=0,rentIncrease=0,days=60}=input;
 if(!Number.isFinite(fxDrop)||fxDrop<0||fxDrop>30||!Number.isInteger(incomeDelay)||incomeDelay<0||incomeDelay>60||!Number.isFinite(rentIncrease)||rentIncrease<0||rentIncrease>2000||!Number.isInteger(days)||days<1||days>180)fail('INPUT','Scenario values are outside the supported range.');
 const {incomes,schedule}=studentSettings(state),rates={...state.market.rates,CNY:state.market.rates.CNY*(1-fxDrop/100)};
 const start=total(state),scenarioStart=total(state,rates),events=[],startDate=new Date(isoDay(now)+'T12:00:00Z');
 const tuitionDay=state.invoice.due<=isoDay(now)?isoDay(now+86400000):state.invoice.due;
 for(let offset=1;offset<=days;offset++){
  const date=new Date(startDate);date.setUTCDate(date.getUTCDate()+offset);const day=isoDay(date);
  if(offset>0&&date.getUTCDate()===monthDay(date,schedule.rentDay))events.push({date:day,amount:-round(state.budget.rent+rentIncrease),type:'Rent',currency:'EUR'});
  if(offset>0&&date.getUTCDay()===1)events.push({date:day,amount:-round((state.budget.groceries+state.budget.transport+state.budget.other)/4.345),type:'Weekly essentials',currency:'EUR'});
  for(const income of incomes)if(income.amount>0&&date.getUTCDate()===monthDay(date,income.payDay)){
   const paid=new Date(date);paid.setUTCDate(paid.getUTCDate()+incomeDelay);
   events.push({date:isoDay(paid),amount:round(income.amount*rates[income.currency]),type:`Expected ${income.label.toLowerCase()}`,uncertain:true,incomeId:income.id,sourceAmount:income.amount,sourceCurrency:income.currency});
  }
  if(offset>0&&!state.invoice.paid&&state.invoice.verified&&day===tuitionDay)events.push({date:day,amount:-round(state.invoice.amount*rates[state.invoice.currency]),type:state.invoice.due<=isoDay(now)?'Overdue tuition':'Tuition'});
 }
 events.sort((a,b)=>a.date.localeCompare(b.date));let balance=scenarioStart;
 const points=[{date:isoDay(now),balance}];
 for(let offset=1;offset<=days;offset++){const date=new Date(startDate);date.setUTCDate(date.getUTCDate()+offset);const day=isoDay(date);for(const e of events.filter(e=>e.date===day))balance=round(balance+e.amount);points.push({date:day,balance});}
 const min=Math.min(...points.map(p=>p.balance)),breach=points.find(p=>p.balance<state.budget.buffer),monthlyIncomeEUR=round(incomes.reduce((sum,i)=>sum+i.amount*rates[i.currency],0));
 return {assumptions:{fxDrop,incomeDelay,rentIncrease,days,monthlyEssentials:essentials(state),rentDay:schedule.rentDay,buffer:state.budget.buffer,monthlyIncomeEUR,incomeDelayPolicy:'Delay applies only to future scheduled income; current balances already include past activity.',incomeSources:incomes.map(i=>({...i,uncertain:true})),rates:'Fixed simulated rates; scenarios are assumptions, not predictions',transferFees:'Transfer fees are applied at sandbox execution; not included in this projection'},startBalance:start,scenarioStart,fxImpact:round(scenarioStart-start),endBalance:points.at(-1).balance,minBalance:min,firstBreach:breach?.date||null,points,events:events.filter(e=>e.date<=points.at(-1).date),recommendation:breach?`Your combined balance would cross the €${state.budget.buffer} buffer on ${breach.date}. Reduce optional spending or arrange funding before that date.`:`Your combined balance stays above the €${state.budget.buffer} buffer for ${days} days under these assumptions.`,liquidityNote:'Combined balances include all currencies. Expected income does not change your accounts. Payment availability and arrival dates are evaluated separately by the tuition planner.'};
}
