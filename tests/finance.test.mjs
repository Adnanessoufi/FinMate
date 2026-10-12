import test from 'node:test'
import assert from 'node:assert/strict'
import { RATES, totalEUR, quote, applyTransfer, parseCSV } from '../finance.js'

test('currency conversion includes fees and conserves value less the fee', () => {
  const before = { EUR: 2840, GBP: 1200, CNY: 18600 }
  const q = quote(5000, 'CNY', 'EUR')
  assert.equal(q.fee, 30)
  assert.equal(q.received, 636.16)
  const after = applyTransfer(before, q)
  assert.equal(after.CNY, 13600)
  assert.equal(after.EUR, 3476.16)
  assert.ok(Math.abs(totalEUR(before) - totalEUR(after) - q.fee * RATES.CNY) < 0.005)
  assert.equal(before.CNY, 18600)
})

test('invalid transfers and insufficient balances are rejected', () => {
  for (const amount of [-1, 0, 0.001, NaN, Infinity, 1000001])
    assert.throws(() => quote(amount, 'CNY', 'EUR'))
  assert.throws(() => quote(10, 'EUR', 'EUR'))
  assert.throws(() => quote(10, 'USD', 'EUR'))
  assert.throws(() => applyTransfer({ CNY: 10, EUR: 0 }, quote(20, 'CNY', 'EUR')), /enough funds/)
})

test('tuition conversion covers exactly €2300 after fees', () => {
  const amount = Math.ceil((2300 / 0.128 / 0.994) * 100) / 100
  const q = quote(amount, 'CNY', 'EUR')
  assert.equal(q.received, 2300)
  const after = applyTransfer({ EUR: 2840, GBP: 1200, CNY: 18600 }, q)
  assert.equal(after.EUR - 2300, 2840)
})

test('CSV supports quoted fields, escaped quotes, BOM, CRLF and multiple currencies', () => {
  const rows = parseCSV(
    '\uFEFFdate,description,amount,currency,category\r\n2026-10-11,"Lunch, coffee",-12.50,eur,Food\r\n2026-10-10,"Book ""Design""",-10,GBP,Study'
  )
  assert.equal(rows.length, 2)
  assert.equal(rows[0].description, 'Lunch, coffee')
  assert.equal(rows[0].currency, 'EUR')
  assert.equal(rows[1].description, 'Book "Design"')
})

test('CSV fails atomically on invalid dates, amounts, currency or headers', () => {
  assert.throws(() => parseCSV('date,description,amount\n2026-10-11,Coffee,-3'))
  for (const row of [
    '2026-02-30,Coffee,-3,EUR',
    '2026-10-11,Coffee,,EUR',
    '2026-10-11,Coffee,NaN,EUR',
    '2026-10-11,Coffee,-3,USD',
    '2026-10-11,,-3,EUR',
  ])
    assert.throws(() => parseCSV('date,description,amount,currency\n' + row))
  assert.throws(() => parseCSV('date,description,amount,currency\n2026-10-11,"Coffee,-3,EUR'))
})

test('prototype properties are not treated as supported currencies or routes', () => {
  assert.throws(() => quote(10, 'constructor', 'EUR'))
  assert.throws(() => quote(10, 'EUR', 'GBP', 'toString'))
})
