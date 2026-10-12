import { randomUUID } from 'node:crypto'
import { fail, appendAudit, studentDefaults } from './store.mjs'
import { isoDay, validCurrency } from './engine.mjs'
import { verifyInvoice } from './invoice.mjs'

export const studentSettings = state => ({
  profile: state.profile || studentDefaults().profile,
  incomes: state.incomes ?? studentDefaults().incomes,
  schedule: state.schedule || { rentDay: 1 },
})

export function saveStudent(state, input, now = Date.now()) {
  if (input.confirmed !== true) fail('SETUP_CONFIRM', 'Review and confirm your student plan.', 403)
  if (!Number.isInteger(input.baseRevision) || input.baseRevision !== state.revision)
    fail(
      'STATE_CHANGED',
      'Your finances changed while you were editing. Reload the setup and review again.',
      409
    )
  const { profile, budget, incomes, schedule } = input
  const keys = ['name', 'university', 'homeCity', 'studyCity']
  if (
    !profile ||
    keys.some(
      k => typeof profile[k] !== 'string' || !profile[k].trim() || profile[k].length > 100
    ) ||
    !validCurrency(profile.homeCurrency)
  )
    fail('PROFILE', 'Check your name, university, cities and home currency.')
  if (
    typeof profile.semesterEnd !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(profile.semesterEnd) ||
    !Number.isFinite(Date.parse(profile.semesterEnd)) ||
    isoDay(Date.parse(profile.semesterEnd)) !== profile.semesterEnd ||
    profile.semesterEnd <= isoDay(now) ||
    profile.semesterEnd > isoDay(now + 180 * 86400000)
  )
    fail('SEMESTER_DATE', 'Choose a semester end within the next 180 days.')
  const budgetKeys = ['rent', 'groceries', 'transport', 'other', 'buffer']
  if (
    !budget ||
    budgetKeys.some(
      k =>
        !Number.isFinite(budget[k]) ||
        budget[k] < 0 ||
        budget[k] > 100000 ||
        Math.abs(budget[k] * 100 - Math.round(budget[k] * 100)) > 1e-7
    )
  )
    fail('BUDGET', 'Use non-negative budget amounts with at most two decimal places.')
  if (
    !schedule ||
    !Number.isInteger(schedule.rentDay) ||
    schedule.rentDay < 1 ||
    schedule.rentDay > 31
  )
    fail('RENT_DAY', 'Choose a monthly rent day from 1 to 31.')
  if (!Array.isArray(incomes) || incomes.length > 5)
    fail('INCOME', 'Add up to five monthly income sources.')
  if (
    incomes.some(
      i =>
        !i ||
        typeof i.label !== 'string' ||
        !i.label.trim() ||
        i.label.length > 80 ||
        !Number.isFinite(i.amount) ||
        i.amount < 0 ||
        i.amount > 100000 ||
        Math.abs(i.amount * 100 - Math.round(i.amount * 100)) > 1e-7 ||
        !validCurrency(i.currency) ||
        !Number.isInteger(i.payDay) ||
        i.payDay < 1 ||
        i.payDay > 31
    )
  )
    fail('INCOME', 'Check each income label, amount, currency and monthly payment day.')
  const next = structuredClone(state)
  if (input.invoice) {
    if (state.invoice.paid)
      fail(
        'ALREADY_PAID',
        'Use Read an invoice to add a new invoice; a paid invoice cannot be edited here.',
        409
      )
    const fields = ['recipient', 'account', 'reference', 'amount', 'currency', 'due']
    if (fields.some(k => input.invoice[k] !== state.invoice[k]) || !state.invoice.verified)
      verifyInvoice(next, { ...input.invoice, confirmed: input.invoiceConfirmed === true }, now)
  }
  next.profile = {
    ...Object.fromEntries(keys.map(k => [k, profile[k].trim()])),
    homeCurrency: profile.homeCurrency,
    semesterEnd: profile.semesterEnd,
    setupComplete: true,
  }
  next.budget = Object.fromEntries(budgetKeys.map(k => [k, budget[k]]))
  next.schedule = { rentDay: schedule.rentDay }
  next.incomes = incomes.map(i => ({
    id: randomUUID(),
    label: i.label.trim(),
    amount: i.amount,
    currency: i.currency,
    payDay: i.payDay,
  }))
  next.revision = state.revision + 1
  appendAudit(
    next,
    'Student plan saved',
    'Profile, monthly budget, income expectations and semester dates reviewed. Account balances unchanged.',
    {
      incomeSources: next.incomes.length,
      semesterEnd: next.profile.semesterEnd,
      rentDay: next.schedule.rentDay,
      revision: next.revision,
    },
    now
  )
  Object.assign(state, next)
  return state
}
