import { randomUUID } from 'node:crypto'
import { fail, round, digest, appendAudit } from './store.mjs'
import { compareFunding, validCurrency, isoDay, businessArrival, ROUTES } from './engine.mjs'
import { assertInvoiceSafe } from './guardian.mjs'

const shareKeys = ['studentName', 'university', 'tuitionTotal', 'studentContribution']
const formatted = (n, c) => `${n.toFixed(2)} ${c}`

export function familyPreview(state, input = {}, now = Date.now()) {
  if (!state.invoice.verified)
    fail('INVOICE_UNVERIFIED', 'Verify tuition before requesting support.')
  if (state.invoice.paid) fail('ALREADY_PAID', 'This tuition invoice has already been paid.', 409)
  assertInvoiceSafe(state)
  const sourceCurrency = input.sourceCurrency || state.profile.homeCurrency,
    currency = input.currency || state.profile.homeCurrency
  if (!validCurrency(currency)) fail('CURRENCY', 'Choose EUR, GBP or CNY for the request.')
  const backups = input.backupCurrencies ?? []
  const plans = compareFunding(state, { sourceCurrency, backupCurrencies: backups }, now)
  const onTime = plans
    .filter(p => p.arrival <= state.invoice.due)
    .sort((a, b) => a.shortfall - b.shortfall || a.costEUR - b.costEUR)
  if (!onTime.length || state.invoice.due < isoDay(now))
    fail(
      'FAMILY_DEADLINE',
      'Current funding cannot arrive before tuition is due. Review the deadline with the university.'
    )
  const plan = onTime[0],
    shortfall = plan.shortfall,
    rate = state.market.rates[currency] / state.market.rates[state.invoice.currency]
  const routes =
    currency === state.invoice.currency
      ? [{ id: 'direct', name: 'Direct tuition contribution', feeRate: 0, days: 1 }]
      : ROUTES
  const quotes = routes
    .map(route => {
      let amount = shortfall ? Math.ceil((shortfall / rate / (1 - route.feeRate)) * 100) / 100 : 0
      let fee = round(amount * route.feeRate),
        received = round((amount - fee) * rate)
      while (received < shortfall) {
        amount = round(amount + 0.01)
        fee = round(amount * route.feeRate)
        received = round((amount - fee) * rate)
      }
      const arrival = businessArrival(now, route.days)
      return {
        route: route.id,
        provider: route.name,
        amount,
        fee,
        received,
        currency,
        arrival,
        eligible: arrival <= state.invoice.due,
      }
    })
    .filter(q => q.eligible)
    .sort((a, b) => a.fee - b.fee)
  if (!quotes.length)
    fail('FAMILY_DEADLINE', 'No simulated contribution route meets the tuition deadline.')
  const quote = quotes[0],
    share = input.share ?? {}
  if (
    !share ||
    typeof share !== 'object' ||
    Array.isArray(share) ||
    Object.keys(share).some(k => !shareKeys.includes(k)) ||
    Object.values(share).some(v => typeof v !== 'boolean')
  )
    fail('FAMILY_PRIVACY', 'Choose only the supported privacy fields.')
  const sharing = Object.fromEntries(shareKeys.map(k => [k, share[k] === true]))
  const netContribution = round(state.invoice.amount - shortfall)
  const lines = [
    'FinMate · tuition funding request',
    'SIMULATED PLANNING ESTIMATE — no funds requested or transferred by FinMate',
    '',
  ]
  if (sharing.studentName) lines.push(`Student: ${state.profile.name}`)
  if (sharing.university) lines.push(`University / recipient: ${state.invoice.recipient}`)
  lines.push(
    `Additional tuition funding needed: ${formatted(shortfall, state.invoice.currency)}`,
    `Estimated contribution to arrange: ${formatted(quote.amount, currency)} (includes ${formatted(quote.fee, currency)} estimated fees)`,
    `Tuition deadline: ${state.invoice.due}`,
    `Estimated arrival if arranged today: ${quote.arrival}`,
    `Illustrative route: ${quote.provider}`
  )
  if (sharing.tuitionTotal)
    lines.push(`Full tuition amount: ${formatted(state.invoice.amount, state.invoice.currency)}`)
  if (sharing.studentContribution)
    lines.push(
      `Student contribution from selected accounts, after conversion fees: ${formatted(netContribution, state.invoice.currency)}`
    )
  lines.push(
    '',
    'Fixed illustrative rates and fees; refresh actual provider quotes before arranging support.',
    'The contribution is an estimate for the tuition recipient, not a credit to the student account.',
    'Check payment details with the university through a contact you already trust.',
    'FinMate does not send this request. No account numbers, invoice references, balances or income details are included.'
  )
  const preview = {
    revision: state.revision,
    marketVersion: state.market.version,
    calculatedOn: isoDay(now),
    invoiceId: state.invoice.id,
    sourceCurrency,
    backupCurrencies: [...backups],
    currency,
    share: sharing,
    shortfall,
    tuitionCurrency: state.invoice.currency,
    studentContribution: netContribution,
    studentFeesEUR: plan.costEUR,
    quote,
    deadline: state.invoice.due,
    funded: shortfall === 0,
    text: lines.join('\n'),
    simulation: true,
  }
  return { ...preview, previewDigest: digest(preview) }
}

export function createFamilyRequest(state, input, now = Date.now()) {
  if (input.confirmed !== true)
    fail('FAMILY_CONFIRM', 'Review the request and the information you chose to include.', 403)
  const preview = familyPreview(state, input, now)
  if (input.previewDigest !== preview.previewDigest)
    fail(
      'STATE_CHANGED',
      'Funding, rates, dates or sharing choices changed. Preview the request again.',
      409
    )
  if (preview.funded)
    fail(
      'FAMILY_FUNDED',
      'Your selected accounts already cover tuition; no additional funding request is needed.'
    )
  const request = {
    id: randomUUID(),
    createdAt: new Date(now).toISOString(),
    text: preview.text,
    previewDigest: preview.previewDigest,
    simulation: true,
  }
  state.familyRequests ??= {}
  state.familyRequests[request.id] = request
  const ids = Object.keys(state.familyRequests)
  for (const id of ids.slice(0, Math.max(0, ids.length - 20))) delete state.familyRequests[id]
  appendAudit(
    state,
    'Family funding request prepared',
    'User reviewed a private download. No message sent and no funds moved.',
    {
      requestId: request.id,
      shortfall: preview.shortfall,
      currency: preview.tuitionCurrency,
      sharing: preview.share,
    },
    now
  )
  return request
}
