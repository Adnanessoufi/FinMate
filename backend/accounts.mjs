import { randomUUID } from 'node:crypto'
import { appendAudit, digest, fail, round } from './store.mjs'

const currencies = ['EUR', 'GBP', 'CNY']
const validBalance = n =>
  Number.isFinite(n) && n >= 0 && n <= 1000000 && Math.abs(n * 100 - Math.round(n * 100)) < 1e-7

export const accountDefaults = () => ({
  origin: 'sample',
  openingBalances: null,
  enteredAt: null,
  deposits: {},
})

export const hasAccountActivity = state =>
  Object.keys(state.accounts?.deposits || {}).length > 0 ||
  Object.values(state.approvals || {}).some(a => a.used)

export function accountStatus(state) {
  const a = state.accounts || accountDefaults()
  return {
    origin: a.origin,
    openingBalances: a.openingBalances,
    enteredAt: a.enteredAt,
    canEditStartingBalances: !hasAccountActivity(state),
    depositCount: Object.keys(a.deposits).length,
    bankConnected: false,
    bankVerified: false,
    paymentsSimulated: true,
  }
}

function invalidatePlans(state) {
  state.revision++
  for (const approval of Object.values(state.approvals || {}))
    if (!approval.used) approval.revoked = true
}

export function setStartingBalances(state, input, now = Date.now()) {
  if (input.confirmed !== true)
    fail('BALANCE_CONFIRM', 'Review and confirm your starting balances.', 403)
  if (!Number.isInteger(input.baseRevision) || input.baseRevision !== state.revision)
    fail('STATE_CHANGED', 'Your account changed. Reload the balances and review again.', 409)
  if (hasAccountActivity(state))
    fail(
      'BALANCE_HISTORY',
      'Starting balances are locked after simulated account activity. Add a simulated deposit, or use a fresh sandbox account.',
      409
    )
  const b = input.balances
  if (
    !b ||
    typeof b !== 'object' ||
    Array.isArray(b) ||
    Object.keys(b).length !== 3 ||
    currencies.some(c => !Object.hasOwn(b, c) || !validBalance(b[c]))
  )
    fail(
      'BALANCES',
      'Enter a non-negative amount for EUR, GBP and CNY, with at most two decimal places and a maximum of 1,000,000 each.'
    )
  if (typeof input.clearSampleHistory !== 'boolean')
    fail('BALANCE_HISTORY_CHOICE', 'Choose whether to remove sample transactions.')
  const before = { ...state.balances },
    next = Object.fromEntries(currencies.map(c => [c, round(b[c])]))
  state.accounts = {
    ...accountDefaults(),
    origin: 'entered',
    openingBalances: { ...next },
    enteredAt: new Date(now).toISOString(),
  }
  state.balances = next
  const sampleCount = state.transactions.filter(t => t.sample).length
  const sampleIncomeCount = (state.incomes || []).filter(i => i.id === 'demo-scholarship').length
  if (input.clearSampleHistory) {
    state.transactions = state.transactions.filter(t => !t.sample)
    state.incomes = (state.incomes || []).filter(i => i.id !== 'demo-scholarship')
  }
  invalidatePlans(state)
  appendAudit(
    state,
    'Starting balances saved',
    'The user entered an unverified balance snapshot for planning. No bank was connected and no real funds moved.',
    {
      before,
      after: { ...next },
      removedSampleTransactions: input.clearSampleHistory ? sampleCount : 0,
      removedSampleIncomeSources: input.clearSampleHistory ? sampleIncomeCount : 0,
      revision: state.revision,
      bankVerified: false,
      simulation: true,
    },
    now
  )
  return accountStatus(state)
}

export function recordDeposit(state, input, now = Date.now()) {
  if (input.confirmed !== true)
    fail('DEPOSIT_CONFIRM', 'Confirm this simulated deposit. No real money will be received.', 403)
  if (
    typeof input.requestId !== 'string' ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(input.requestId)
  )
    fail('DEPOSIT_ID', 'Use a valid deposit request identifier.')
  if (
    !currencies.includes(input.currency) ||
    !validBalance(input.amount) ||
    input.amount < 0.01 ||
    typeof input.label !== 'string' ||
    !input.label.trim() ||
    input.label.length > 80
  )
    fail(
      'DEPOSIT_INPUT',
      'Choose EUR, GBP or CNY, a positive amount with at most two decimal places, and a short description.'
    )
  const payload = {
      currency: input.currency,
      amount: round(input.amount),
      label: input.label.trim(),
    },
    fingerprint = digest(payload),
    a = state.accounts || accountDefaults()
  if (Object.hasOwn(a.deposits, input.requestId)) {
    const old = a.deposits[input.requestId]
    if (old.fingerprint !== fingerprint)
      fail(
        'DEPOSIT_MISMATCH',
        'This request identifier was already used for a different deposit.',
        409
      )
    return { ...old.receipt, replayed: true }
  }
  if (a.origin !== 'entered')
    fail('BALANCE_SETUP', 'Enter your starting balances before recording deposits.', 409)
  if (!Number.isInteger(input.baseRevision) || input.baseRevision !== state.revision)
    fail('STATE_CHANGED', 'Your account changed. Review the simulated deposit again.', 409)
  if (Object.keys(a.deposits).length >= 500)
    fail('DEPOSIT_LIMIT', 'This sandbox has reached its deposit-history limit.', 409)
  const after = round(state.balances[payload.currency] + payload.amount)
  if (after > 1000000)
    fail('DEPOSIT_LIMIT', 'This deposit would exceed the sandbox account limit of 1,000,000.')
  const transactionId = randomUUID(),
    receipt = {
      id: randomUUID(),
      requestId: input.requestId,
      transactionId,
      ...payload,
      beforeBalance: state.balances[payload.currency],
      afterBalance: after,
      recordedAt: new Date(now).toISOString(),
      simulation: true,
      bankVerified: false,
    }
  state.balances[payload.currency] = after
  state.transactions.unshift({
    id: transactionId,
    date: receipt.recordedAt.slice(0, 10),
    description: payload.label,
    category: 'Simulated deposit',
    amount: payload.amount,
    currency: payload.currency,
    simulation: true,
  })
  invalidatePlans(state)
  const entry = appendAudit(
    state,
    'Simulated deposit recorded',
    'A user-confirmed sandbox credit was recorded once. No bank transfer or real deposit occurred.',
    {
      receiptId: receipt.id,
      transactionId,
      currency: payload.currency,
      amount: payload.amount,
      beforeBalance: receipt.beforeBalance,
      afterBalance: after,
      revision: state.revision,
      simulation: true,
    },
    now
  )
  receipt.auditId = entry.id
  a.deposits[input.requestId] = { fingerprint, receipt }
  state.accounts = a
  return { ...receipt, replayed: false }
}
