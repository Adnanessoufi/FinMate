import test from 'node:test'
import assert from 'node:assert/strict'
import { parseCSV } from '../finance.js'

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
