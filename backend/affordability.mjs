import { fail, round } from './store.mjs';
import { isoDay, essentials } from './engine.mjs';
import { forecast } from './forecast.mjs';

// Planning only: no drafts, approvals or account mutations.
export function affordability(state, input = {}, now = Date.now()) {
  const { amount, currency = 'EUR', date = isoDay(now), label = 'Optional purchase', fxDrop = 0, incomeDelay = 0, rentIncrease = 0 } = input;
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1000000 || Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-7)
    fail('INPUT', 'Enter a positive amount with at most two decimal places, up to 1,000,000.');
  if (!['EUR', 'GBP', 'CNY'].includes(currency)) fail('INPUT', 'Choose EUR, GBP or CNY.');
  const today = isoDay(now), lastDay = isoDay(now + 60 * 86400000);
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || isoDay(Date.parse(date)) !== date || date < today || date > lastDay)
    fail('INPUT', 'Choose a valid purchase date from today through the next 60 days.');
  if (typeof label !== 'string' || !label.trim() || label.length > 100) fail('INPUT', 'Describe the purchase in 1–100 characters.');
  const baseline = forecast(state, { fxDrop, incomeDelay, rentIncrease }, now);
  const rate = state.market.rates[currency] * (currency === 'CNY' ? 1 - fxDrop / 100 : 1);
  // Round expenses upward so fractional euro cents never enlarge the limit.
  const costEUR = Math.ceil((amount * rate - 1e-9) * 100) / 100;
  const proposed = baseline.points.map(p => ({ ...p, balance: p.date >= date ? round(p.balance - costEUR) : p.balance }));
  const reliablePoints = baseline.points.map(p => ({ ...p, balance: round(p.balance - baseline.events.filter(e => e.uncertain && e.date <= p.date).reduce((n, e) => n + e.amount, 0)) }));
  const reliableProposed = reliablePoints.map(p => ({ ...p, balance: p.date >= date ? round(p.balance - costEUR) : p.balance }));
  const future = reliablePoints.filter(p => p.date >= date);
  const minWithoutIncome = Math.min(...future.map(p => p.balance));
  const baselineBreach = reliablePoints.some(p => p.balance < state.budget.buffer);
  const budgetRoom = baselineBreach ? 0 : Math.max(0, round(minWithoutIncome - state.budget.buffer));
  const protectedEUR = state.budget.buffer + essentials(state) + rentIncrease;
  const euroAccountRoom = currency === 'EUR' ? Math.max(0, round(state.balances.EUR - protectedEUR)) : state.balances[currency];
  const invoiceVerified = state.invoice.paid || state.invoice.verified;
  const maxAmount = invoiceVerified ? Math.floor((Math.min(budgetRoom / rate, euroAccountRoom) + 1e-9) * 100) / 100 : null;
  const minAfter = Math.min(...reliableProposed.map(p => p.balance));
  const lowestExpected = Math.min(...proposed.map(p => p.balance));
  const breach = reliableProposed.find(p => p.balance < state.budget.buffer)?.date || null;
  const accountShortfall = Math.max(0, round(amount - euroAccountRoom));
  const shortfallEUR = Math.max(0, round(state.budget.buffer - minAfter));
  const weeklyCushion = round((state.budget.groceries + state.budget.transport + state.budget.other) / 4.345);
  const status = !invoiceVerified ? 'verify' : amount > maxAmount || breach ? 'shortfall' : Math.min(minAfter - state.budget.buffer, (euroAccountRoom - amount) * rate) < weeklyCushion ? 'tight' : 'comfortable';
  const dependentOnIncome = status === 'shortfall' && !accountShortfall && lowestExpected >= state.budget.buffer;
  // A later date may help only if the student confirms that expected income arrived.
  const later = invoiceVerified && dependentOnIncome ? baseline.events.filter(e => e.uncertain && e.date > date).find(e => {
    const arrivedIncome = baseline.events.filter(i => i.uncertain && i.date <= e.date).reduce((n, i) => n + i.amount, 0);
    return Math.min(...reliablePoints.filter(p => p.date >= e.date).map(p => p.balance)) + arrivedIncome - costEUR >= state.budget.buffer;
  }) : null;
  let reason = status === 'verify' ? 'Verify your unpaid tuition invoice before relying on a spending limit.'
    : accountShortfall ? `Your ${currency} account cannot cover this purchase while preserving monthly euro essentials and the buffer. A combined balance is not spendable cash in this account.`
    : status === 'shortfall' ? `This purchase would leave your combined balance below your emergency buffer on ${breach}.`
    : status === 'tight' ? minAfter - state.budget.buffer < weeklyCushion ? 'It fits, but the forecast leaves less than one week of variable essentials above your buffer.' : `It fits, but your ${currency} paying account has less than one week of variable essentials left beyond its protected funds.`
    : 'It fits while covering forecast essentials, verified tuition and your buffer, even if expected income payments do not arrive.';
  if (dependentOnIncome) reason += ' It fits only in the projection that includes expected income.';
  return {
    input: { amount, currency, date, label: label.trim(), fxDrop, incomeDelay, rentIncrease }, status, reason,
    costEUR, protectedEUR, maxAmount, maxEUR: maxAmount === null ? null : round(maxAmount * rate),
    minBefore: Math.min(...reliablePoints.map(p => p.balance)), minAfter, lowestExpected, buffer: state.budget.buffer,
    shortfallEUR, accountShortfall, firstBreach: breach, dependentOnIncome,
    suggestedDate: later?.date || null, suggestedDateCondition: later ? 'Only after expected income has actually arrived; recheck the paying account.' : null,
    baseline: { points: reliablePoints, events: baseline.events.filter(e => !e.uncertain), assumptions: { ...baseline.assumptions, monthlyIncomeEUR: 0, incomePolicy: 'Excluded until it arrives' } }, proposed: { points: reliableProposed }, expected: { points: proposed },
    assumptions: [
      'The spending limit excludes all expected income until it arrives.',
      'Rent and weekly essentials follow your saved budget; unpaid verified tuition is included.',
      'All currencies are valued at fixed simulated rates, adjusted by the selected stress scenario.',
      'The paying account must already hold the funds. EUR spending preserves one month of euro essentials (including extra scenario rent) plus the buffer. Future income is not assigned to an account.',
      'Conversion and transfer fees are excluded. Use the tuition or transfer planner before moving currencies.',
      'This checks one hypothetical purchase across 60 days. It neither reserves money nor executes a payment.',
      ...(!invoiceVerified ? ['Unverified tuition is excluded from the chart; no reliable limit is available.'] : [])
    ], revision: state.revision, marketVersion: state.market.version, calculatedOn: today
  };
}
