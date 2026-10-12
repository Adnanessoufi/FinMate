export const RATES = Object.freeze({ EUR: 1, GBP: 1.17, CNY: 0.128 })

export const FEES = Object.freeze({ FinMate: 0.006, 'Bank transfer': 0.022, 'Card payment': 0.032 })

export const money = (amount, currency = 'EUR', digits = 2) =>
  new Intl.NumberFormat('en-IE', {
    style: 'currency',
    currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(amount)

export const totalEUR = balances =>
  Object.entries(balances).reduce(
    (total, [currency, amount]) => total + amount * RATES[currency],
    0
  )

export function quote(amount, from, to, provider = 'FinMate') {
  if (!Number.isFinite(amount) || amount < 0.01 || amount > 1000000)
    throw new Error('Enter an amount between 0.01 and 1,000,000.')
  if (!Object.hasOwn(RATES, from) || !Object.hasOwn(RATES, to) || !Object.hasOwn(FEES, provider))
    throw new Error('Choose a supported currency and route.')
  if (from === to) throw new Error('Choose two different currencies.')
  const fee = Math.round(amount * FEES[provider] * 100) / 100
  return {
    amount,
    from,
    to,
    provider,
    fee,
    received: Math.round((((amount - fee) * RATES[from]) / RATES[to]) * 100) / 100,
    rate: RATES[from] / RATES[to],
  }
}

export function applyTransfer(balances, transfer) {
  const checked = quote(transfer.amount, transfer.from, transfer.to, transfer.provider)
  if (!Number.isFinite(balances[checked.from]) || balances[checked.from] < checked.amount)
    throw new Error('Your source account does not have enough funds.')
  return {
    ...balances,
    [checked.from]: Math.round((balances[checked.from] - checked.amount) * 100) / 100,
    [checked.to]: Math.round(((balances[checked.to] || 0) + checked.received) * 100) / 100,
  }
}

export function parseCSV(text) {
  const rows = []
  let row = [],
    field = '',
    quoted = false
  text = text.replace(/^\uFEFF/, '')
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (char === '"') {
      if (quoted && text[i + 1] === '"') {
        field += '"'
        i++
      } else quoted = !quoted
    } else if (char === ',' && !quoted) {
      row.push(field.trim())
      field = ''
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[i + 1] === '\n') i++
      row.push(field.trim())
      if (row.some(Boolean)) rows.push(row)
      row = []
      field = ''
    } else field += char
  }
  if (quoted) throw new Error('A quoted field is not closed. Check your CSV file.')
  row.push(field.trim())
  if (row.some(Boolean)) rows.push(row)
  if (rows.length < 2) throw new Error('Include a header and at least one transaction.')
  const headers = rows.shift().map(value => value.toLowerCase())
  const required = ['date', 'description', 'amount', 'currency']
  if (!required.every(key => headers.includes(key)))
    throw new Error('Use the columns: date, description, amount, currency.')
  return rows.map((values, index) => {
    const entry = Object.fromEntries(headers.map((header, i) => [header, values[i] ?? '']))
    const amount = Number(entry.amount)
    const date = new Date(entry.date + 'T12:00:00Z')
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(entry.date) ||
      Number.isNaN(date.valueOf()) ||
      date.toISOString().slice(0, 10) !== entry.date ||
      !entry.description ||
      entry.amount === '' ||
      !Number.isFinite(amount) ||
      !Object.hasOwn(RATES, entry.currency.toUpperCase())
    )
      throw new Error(
        `Row ${index + 2}: check the date, description, amount, and currency (EUR, GBP or CNY).`
      )
    return {
      date: entry.date,
      description: entry.description,
      amount,
      currency: entry.currency.toUpperCase(),
      category: entry.category || 'Imported',
      id: crypto.randomUUID(),
    }
  })
}
