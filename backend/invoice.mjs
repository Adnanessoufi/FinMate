import { checkInvoice, guardianDefaults, invoiceSnapshot, referenceKey } from './guardian.mjs'
import { fail, appendAudit } from './store.mjs'
import { validAmount, validCurrency, isoDay } from './engine.mjs'
import { randomUUID } from 'node:crypto'

export function extractInvoice(text) {
  if (typeof text !== 'string' || text.trim().length < 10 || text.length > 50000)
    fail('INVOICE_TEXT', 'Provide invoice text between 10 and 50,000 characters.')
  const clean = text.replace(/\r/g, '')
  const fields = {}
  const evidence = {}
  const pick = (name, regex) => {
    const match = clean.match(regex)
    if (match) {
      fields[name] = match[1].trim()
      evidence[name] = match[0].trim()
    }
  }
  pick('recipient', /(?:recipient|payee|institution|university name)\s*[:=]\s*([^\n]+)/i)
  pick('account', /(?:account|iban|payment account)\s*[:=]\s*([^\n]+)/i)
  pick('reference', /(?:invoice(?: number| reference)?|reference)\s*[:=#]\s*([^\n]+)/i)
  pick('due', /(?:due(?: date)?|payment deadline)\s*[:=]\s*(\d{4}-\d{2}-\d{2})/i)
  pick('currency', /(?:currency)\s*[:=]\s*(EUR|GBP|CNY)\b/i)
  const amount = clean.match(
    /(?:total(?: due| amount)?|amount(?: due)?|tuition fee)\s*[:=]\s*(?:EUR|GBP|CNY|Ã¢â€šÂ¬|Ã‚Â£|Ã‚Â¥)?\s*([\d,]+(?:\.\d{1,2})?)/i
  )
  if (amount) {
    fields.amount = Number(amount[1].replaceAll(',', ''))
    evidence.amount = amount[0].trim()
  }
  if (!fields.currency) {
    const match = clean.match(
      /(?:total(?: due| amount)?|amount(?: due)?|tuition fee)\s*[:=]\s*(EUR|GBP|CNY|Ã¢â€šÂ¬|Ã‚Â£|Ã‚Â¥)/i
    )
    if (match) {
      fields.currency =
        { 'Ã¢â€šÂ¬': 'EUR', 'Ã‚Â£': 'GBP', 'Ã‚Â¥': 'CNY' }[match[1]] || match[1].toUpperCase()
      evidence.currency = match[0].trim()
    }
  }
  if (fields.currency) fields.currency = fields.currency.toUpperCase()
  const missing = ['recipient', 'account', 'reference', 'amount', 'currency', 'due'].filter(
    key => !fields[key]
  )
  const warnings = []
  if (
    /ignore.{0,30}(?:instructions|rules)|system prompt|bypass|approve automatically|execute.{0,30}without/i.test(
      clean
    )
  )
    warnings.push(
      'Instructions embedded in this document were ignored. Only invoice fields are extracted.'
    )
  if (missing.length) warnings.push(`Check missing fields: ${missing.join(', ')}.`)
  if (fields.amount && !validAmount(fields.amount)) warnings.push('The amount needs correction.')
  return { fields, evidence, missing, warnings, method: 'Local field extraction', verified: false }
}

export function verifyInvoice(state, input, now = Date.now()) {
  if (input.confirmed !== true)
    fail('VERIFY_REQUIRED', 'Confirm that you checked each invoice field.', 403)
  const { recipient, account, reference, amount, currency, due } = input
  if (
    ![recipient, account, reference].every(
      v => typeof v === 'string' && v.trim().length >= 2 && v.length <= 160
    ) ||
    !validAmount(amount) ||
    !validCurrency(currency) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(due || '')
  )
    fail('INVOICE_FIELDS', 'Check recipient, account, reference, amount, currency and due date.')
  const date = new Date(due + 'T12:00:00Z')
  if (
    Number.isNaN(date.valueOf()) ||
    isoDay(date) !== due ||
    due < isoDay(now) ||
    due > isoDay(now + 366 * 86400000)
  )
    fail('INVOICE_DATE', 'Choose a valid deadline within the next year.')
  const normalizedRef = reference.trim().toLowerCase(),
    normalizedAccount = account.trim().toLowerCase()
  if (
    state.audit.some(
      a =>
        a.details.invoiceReference &&
        referenceKey(a.details.invoiceReference) === referenceKey(normalizedRef)
    )
  )
    fail('ALREADY_PAID', 'An invoice with this reference has already been paid.', 409)
  const same =
    !state.invoice.paid &&
    ['recipient', 'account', 'reference', 'amount', 'currency', 'due'].every(
      k => state.invoice[k] === (typeof input[k] === 'string' ? input[k].trim() : input[k])
    )
  if (same && state.invoice.verified) {
    appendAudit(
      state,
      'Invoice details rechecked',
      'The user rechecked the unchanged invoice. Payment still requires separate approval.',
      { invoiceId: state.invoice.id },
      now
    )
    return state.invoice
  }
  state.guardian ??= guardianDefaults(state.invoice)
  if (state.invoice.verified && checkInvoice(state).canPlan)
    state.guardian.baseline = invoiceSnapshot(state.invoice)
  state.guardian.review = null
  state.invoice = {
    id: same ? state.invoice.id : randomUUID(),
    recipient: recipient.trim(),
    account: account.trim(),
    reference: reference.trim(),
    amount,
    currency,
    due,
    verified: true,
    paid: false,
  }
  state.tuitionPaid = false
  state.revision++
  if (!state.guardian.history.some(i => i.id === state.invoice.id))
    state.guardian.history.push(invoiceSnapshot(state.invoice))
  appendAudit(
    state,
    'Invoice details verified',
    'The user reviewed the extracted fields. Payment still requires separate approval.',
    { invoiceId: state.invoice.id, reference: state.invoice.reference },
    now
  )
  return state.invoice
}

export async function pdfText(bytes) {
  let pdfjs
  try {
    pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  } catch {
    fail(
      'PDF_UNAVAILABLE',
      'PDF support is unavailable. Paste the invoice text or try again later.',
      503
    )
  }
  const task = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    useSystemFonts: true,
    isEvalSupported: false,
    useWorkerFetch: false,
    enableScripting: false,
  })
  try {
    const document = await task.promise
    if (document.numPages > 10) fail('PDF_LIMIT', 'Use an invoice with at most 10 pages.')
    let text = ''
    for (let n = 1; n <= document.numPages; n++) {
      const page = await document.getPage(n)
      const content = await page.getTextContent()
      for (const item of content.items) {
        text += item.str + (item.hasEOL ? '\n' : ' ')
      }
      text += '\n'
    }
    if (!text.trim())
      fail('PDF_SCANNED', 'This PDF has no readable text. Paste its text or use a text-based PDF.')
    return text
  } finally {
    await task.destroy()
  }
}
