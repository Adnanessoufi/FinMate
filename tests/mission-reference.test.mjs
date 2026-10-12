import { affordability } from '../backend/affordability.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { initialState, Store, verifyAudit } from '../backend/store.mjs'
import { tuitionMission, prepareMission } from '../backend/mission.mjs'
import { setStartingBalances } from '../backend/accounts.mjs'
import {
  parseReferenceXML,
  referenceStatus,
  ReferenceRates,
  PACKAGED_REFERENCE,
} from '../backend/reference-rates.mjs'
import { runAgent, dispatchTool, affordabilityAnswer } from '../backend/agent.mjs'
import { createApp } from '../server.mjs'

const NOW = Date.parse('2026-10-11T10:00:00Z')
const seed = () => {
  const s = initialState(NOW)
  setStartingBalances(
    s,
    {
      balances: { EUR: 2840, GBP: 1200, CNY: 18600 },
      baseRevision: s.revision,
      confirmed: true,
      clearSampleHistory: false,
    },
    NOW
  )
  return s
}
const prepareInput = p => ({
  ...p.input,
  planDigest: p.planDigest,
  baseRevision: p.revision,
  marketVersion: p.marketVersion,
  confirmed: true,
})
const xml = (date = '2026-10-09', gbp = '.84763') =>
  `<gesmes:Envelope><Cube><Cube time="${date}"><Cube currency="GBP" rate="${gbp.startsWith('.') ? '0' + gbp : gbp}"/><Cube currency="CNY" rate="7.4992"/></Cube></Cube></gesmes:Envelope>`

test('tuition workflow blocks sample balances and never treats expected income as funds', () => {
  const s = initialState(NOW)
  const before = JSON.stringify(s.balances)
  const p = tuitionMission(s, { sourceCurrency: 'EUR', incomeDelay: 14 }, NOW)
  assert.ok(p.blockers.some(b => b.id === 'balances'))
  assert.equal(p.availableIncome, 0)
  assert.equal(p.recommended, null)
  assert.equal(JSON.stringify(s.balances), before)
  assert.throws(
    () => prepareMission(s, prepareInput(p), NOW),
    e => e.code === 'MISSION_BLOCKED'
  )
})

test('workflow chooses eligible deadline route and shows rejected cheap alternative', () => {
  const s = seed()
  s.invoice.due = '2026-10-12'
  const p = tuitionMission(s, {}, NOW)
  assert.equal(p.status, 'ready')
  assert.equal(p.recommended.route, 'student')
  assert.equal(p.alternatives.find(q => q.route === 'bank').eligible, false)
  assert.equal(p.protectedEUR, 2030)
  const d = prepareMission(s, prepareInput(p), NOW)
  assert.equal(d.type, 'tuition')
  assert.equal(d.status, undefined)
  assert.equal(s.invoice.paid, false)
  assert.ok(verifyAudit(s.audit))
})

test('workflow requires explicit backups and preserves EUR reserve', () => {
  const s = seed()
  s.market.rates.CNY *= 0.95
  assert.equal(tuitionMission(s, { sourceCurrency: 'CNY' }, NOW).status, 'blocked')
  const p = tuitionMission(
    s,
    { sourceCurrency: 'CNY', backupCurrencies: ['GBP'], incomeDelay: 14 },
    NOW
  )
  assert.equal(p.status, 'ready')
  assert.equal(p.recommended.type, 'tuition-funding')
  assert.ok(p.recommended.legs.some(l => l.from === 'GBP'))
  assert.ok(p.recommended.legs.every(l => l.from !== 'EUR'))
  assert.ok(p.recommended.remainingEUR >= p.protectedEUR)
})

test('income delay cannot manufacture funding or change accounts', () => {
  const s = seed()
  s.balances.CNY = 0
  s.balances.GBP = 0
  s.incomes = [{ id: 'future', label: 'Support', amount: 10000, currency: 'EUR', payDay: 12 }]
  const p = tuitionMission(s, { sourceCurrency: 'EUR', incomeDelay: 0 }, NOW)
  assert.equal(p.status, 'blocked')
  assert.equal(p.availableIncome, 0)
  assert.equal(s.balances.EUR, 2840)
})

test('workflow consent, digest and stale revision are enforced', () => {
  const s = seed(),
    p = tuitionMission(s, {}, NOW),
    input = prepareInput(p)
  assert.throws(
    () => prepareMission(s, { ...input, confirmed: false }, NOW),
    e => e.code === 'MISSION_CONSENT'
  )
  assert.throws(
    () => prepareMission(s, { ...input, backupCurrencies: ['GBP'] }, NOW),
    e => e.code === 'MISSION_CHANGED'
  )
  s.revision++
  assert.throws(
    () => prepareMission(s, input, NOW),
    e => e.code === 'MISSION_CHANGED'
  )
  assert.equal(Object.keys(s.drafts).length, 0)
})

test('rate, day, budget, invoice and balances invalidate reviewed workflow', () => {
  for (const change of [
    s => (s.market.rates.CNY *= 0.98),
    s => (s.budget.buffer += 1),
    s => (s.invoice.account = 'changed'),
    s => (s.balances.CNY -= 1),
  ]) {
    const s = seed(),
      p = tuitionMission(s, {}, NOW)
    change(s)
    assert.throws(
      () => prepareMission(s, prepareInput(p), NOW),
      e => e.code === 'MISSION_CHANGED'
    )
  }
  const s = seed(),
    p = tuitionMission(s, {}, NOW)
  assert.throws(
    () => prepareMission(s, prepareInput(p), NOW + 86400000),
    e => e.code === 'MISSION_CHANGED'
  )
})

test('changed and unverified invoices block workflow comparison and paid invoices cannot repeat', () => {
  const s = seed()
  s.invoice.verified = false
  assert.equal(tuitionMission(s, {}, NOW).alternatives.length, 0)
  s.invoice.verified = true
  s.invoice.account = 'CHANGED'
  const p = tuitionMission(s, {}, NOW)
  assert.ok(p.blockers.some(b => b.id === 'guardian'))
  assert.equal(p.alternatives.length, 0)
  s.invoice.paid = true
  const paid = tuitionMission(s, {}, NOW)
  assert.equal(paid.status, 'paid')
  assert.throws(
    () => prepareMission(s, prepareInput(paid), NOW),
    e => e.code === 'MISSION_BLOCKED'
  )
})

test('invalid workflow choices and delay are rejected', () => {
  for (const input of [
    { sourceCurrency: 'USD' },
    { backupCurrencies: ['EUR', 'EUR'] },
    { backupCurrencies: ['CNY'] },
    { incomeDelay: 1.5 },
    { incomeDelay: -1 },
    { incomeDelay: 61 },
  ])
    assert.throws(
      () => tuitionMission(seed(), input, NOW),
      e => e.code === 'MISSION_INPUT'
    )
})

test('reference feed validates positive currencies, duplicates, dates and entities', () => {
  assert.equal(parseReferenceXML(xml(), NOW).perEUR.CNY, 7.4992)
  for (const raw of [
    xml().replace('0.84763', '0'),
    xml().replace('GBP', 'USD'),
    xml().replace('</Cube></Cube>', '<Cube currency="GBP" rate="1"/></Cube></Cube>'),
    xml('2026-02-30'),
    xml('2027-01-01'),
    '<!DOCTYPE test>' + xml(),
    xml().replace('7.4992', 'NaN'),
  ])
    assert.throws(() => parseReferenceXML(raw, NOW))
})

test('reference rates distinguish observation age from connectivity', () => {
  assert.equal(
    referenceStatus(PACKAGED_REFERENCE, { now: NOW, connection: 'offline' }).freshness,
    'recent'
  )
  const r = referenceStatus(PACKAGED_REFERENCE, { now: NOW + 8 * 86400000, connection: 'online' })
  assert.equal(r.freshness, 'stale')
  assert.equal(r.informationalOnly, true)
  assert.equal(r.paymentQuotesSimulated, true)
})

test('reference service deduplicates refreshes, caches and falls back without changing rates', async () => {
  let calls = 0
  const service = new ReferenceRates({
    now: () => NOW,
    fetchImpl: async () => {
      calls++
      return new Response(xml())
    },
  })
  const [a, b] = await Promise.all([service.get(), service.get()])
  assert.deepEqual(a, b)
  assert.equal(calls, 1)
  await service.get()
  assert.equal(calls, 1)
  const fallback = await new ReferenceRates({
    now: () => NOW,
    fetchImpl: async () => {
      throw Error('offline')
    },
  }).get()
  assert.equal(fallback.connection, 'offline')
  assert.equal(fallback.observationDate, '2026-10-09')
})

test('reference service rejects oversized or regressing feeds and keeps validated snapshot', async () => {
  for (const response of [
    new Response(xml('2026-10-08')),
    new Response('x'.repeat(100001)),
    new Response('bad', { status: 500 }),
  ]) {
    const r = await new ReferenceRates({ now: () => NOW, fetchImpl: async () => response }).get()
    assert.equal(r.connection, 'offline')
    assert.equal(r.perEUR.GBP, 0.84763)
  }
})

async function withStore(fn) {
  const directory = await mkdtemp(join(tmpdir(), 'finmate-mission-'))
  try {
    const store = await new Store(join(directory, 'state.json')).init()
    const { id } = await store.create()
    await fn(store, id)
  } finally {
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()))
    await rm(directory, { recursive: true, force: true })
  }
}

test('Chinese offline clarification and language validation preserve balances and approval authority', async () =>
  withStore(async (store, id) => {
    const before = JSON.stringify(store.sessions[id].state.balances)
    const r = await runAgent(store, id, '学费怎么办？', {
      config: { mode: 'offline' },
      language: 'zh',
    })
    assert.match(r.answer, /EUR|GBP|CNY/)
    assert.match(r.answer, /[\u4e00-\u9fff]/)
    assert.equal(r.draft, null)
    assert.equal(JSON.stringify(store.sessions[id].state.balances), before)
    assert.equal(store.sessions[id].state.chat.at(-1).content, r.answer)
    await assert.rejects(
      runAgent(store, id, 'hello', { language: 'xx' }),
      e => e.code === 'CHAT_LANGUAGE'
    )
    await assert.rejects(
      dispatchTool(store, id, 'prepare_mission', { confirmed: true }),
      e => e.code === 'TOOL_FORBIDDEN'
    )
  }))

test('HTTP workflow rejects injected fields and cross-site requests before payment preparation', async () =>
  withStore(async (store, id) => {
    const { server } = await createApp({ path: store.path })
    await new Promise(r => server.listen(0, '127.0.0.1', r))
    try {
      const base = `http://127.0.0.1:${server.address().port}`,
        response = await fetch(base + '/api/bootstrap'),
        boot = await response.json(),
        cookie = response.headers.get('set-cookie').split(';')[0],
        headers = {
          Cookie: cookie,
          Origin: base,
          'Content-Type': 'application/json',
          'X-FinMate-CSRF': boot.csrf,
        }
      let r = await fetch(base + '/api/mission/plan', {
        method: 'POST',
        headers,
        body: JSON.stringify({ sourceCurrency: 'CNY', execute: true }),
      })
      assert.equal(r.status, 400)
      r = await fetch(base + '/api/mission/prepare', {
        method: 'POST',
        headers: { ...headers, Origin: 'https://evil.invalid' },
        body: '{}',
      })
      assert.equal(r.status, 403)
      r = await fetch(base + '/api/mission/plan', {
        method: 'POST',
        headers,
        body: JSON.stringify({ sourceCurrency: 'CNY' }),
      })
      assert.equal((await r.json()).plan.status, 'blocked')
    } finally {
      await new Promise(r => server.close(r))
    }
  }))

test('grounded affordability explanations distinguish emergency buffer and paying reserve in both languages', () => {
  const r = affordability(seed(), { amount: 180, currency: 'EUR' }, NOW)
  const en = affordabilityAnswer(r, 'en'),
    zh = affordabilityAnswer(r, 'zh')
  assert.ok(en.includes(r.minAfter.toFixed(2)))
  assert.ok(zh.includes(r.minAfter.toFixed(2)))
  assert.match(en, /Emergency buffer for that projection: 900.00 EUR/)
  assert.match(en, /Separate EUR living-cost and buffer reserve at payment time: 2030.00 EUR/)
  assert.match(zh, /应急缓冲金：900.00 EUR/)
  assert.match(zh, /生活费用加缓冲储备：2030.00 EUR/)
})

test('Chinese credential disclosure is rejected before any model call', async () =>
  withStore(async (store, id) => {
    await assert.rejects(
      runAgent(store, id, '我的密码是 123456', {
        language: 'zh',
        config: { mode: 'live' },
        fetchImpl: () => {
          throw Error('Must not call provider')
        },
      }),
      e => e.code === 'CHAT_SECRET'
    )
    assert.equal(store.sessions[id].state.chat.length, 0)
  }))

test('provider availability fallback is explicit, persisted and has no execution authority', async () =>
  withStore(async (store, id) => {
    const before = JSON.stringify(store.sessions[id].state.balances)
    const result = await runAgent(store, id, 'Can I afford a EUR 180 trip?', {
      config: { mode: 'live', model: 'fixture' },
      fetchImpl: async () => new Response('{}', { status: 429 }),
    })
    assert.equal(result.mode, 'offline')
    assert.equal(result.fallback.reason, 'MODEL_UNAVAILABLE')
    assert.match(result.answer, /offline planner/)
    assert.equal(result.assessment.input.amount, 180)
    assert.equal(store.sessions[id].state.chat.at(-1).content, result.answer)
    assert.equal(JSON.stringify(store.sessions[id].state.balances), before)
    assert.equal(Object.keys(store.sessions[id].state.approvals).length, 0)
    assert.ok(verifyAudit(store.sessions[id].state.audit))
    await assert.rejects(
      runAgent(store, id, 'Hello', {
        config: { mode: 'live' },
        allowFallback: false,
        fetchImpl: async () => new Response('{}', { status: 429 }),
      }),
      e => e.code === 'MODEL_UNAVAILABLE'
    )
  }))
