const currencies = ['EUR', 'GBP', 'CNY']

export const money = (amount, currency = 'EUR', digits = 2) =>
  new Intl.NumberFormat('en-IE', {
    style: 'currency',
    currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(amount)

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
      !currencies.includes(entry.currency.toUpperCase())
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
