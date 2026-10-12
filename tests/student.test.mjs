import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { initialState, Store, verifyAudit } from '../backend/store.mjs'
import { saveStudent } from '../backend/student.mjs'
import { forecast } from '../backend/forecast.mjs'
import { affordability } from '../backend/affordability.mjs'
import { semesterPlan } from '../backend/semester.mjs'
import { prepare, approveDraft, executeDraft } from '../backend/engine.mjs'
import { dispatchTool, runAgent } from '../backend/agent.mjs'
import { createApp } from '../server.mjs'

const NOW = Date.parse('2026-10-11T10:00:00Z')
const seed = () => initialState(NOW)
const input = s => ({
  profile: {
    ...s.profile,
    name: 'Amina Chen',
    university: 'Example University',
    homeCity: 'Shenzhen',
    studyCity: 'Amsterdam',
    homeCurrency: 'GBP',
  },
  budget: { ...s.budget },
  schedule: { rentDay: 15 },
  incomes: [{ label: 'Family support', amount: 500, currency: 'GBP', payDay: 20 }],
  baseRevision: s.revision,
  confirmed: true,
})
const clean = async directory => {
  assert.equal(dirname(resolve(directory)), resolve(tmpdir()))
  await rm(directory, { recursive: true, force: true })
}

test('student setup personalizes forecasts without crediting future income or changing balances', () => {
  const s = seed(),
    before = { ...s.balances }
  saveStudent(s, input(s), NOW)
  assert.equal(s.profile.name, 'Amina Chen')
  assert.equal(s.profile.setupComplete, true)
  assert.equal(s.revision, 1)
  assert.deepEqual(s.balances, before)
  assert.equal(s.invoice.recipient, 'University of Amsterdam')
  const result = forecast(s, {}, NOW)
  assert.equal(result.assumptions.monthlyIncomeEUR, 585)
  assert.ok(result.events.some(e => e.type === 'Rent' && e.date === '2026-10-15'))
  assert.ok(
    result.events.some(
      e => e.uncertain && e.sourceCurrency === 'GBP' && e.sourceAmount === 500 && e.amount === 585
    )
  )
  assert.ok(!result.events.some(e => e.type === 'Expected scholarship'))
  assert.ok(verifyAudit(s.audit))
})

test('zero or removed income never falls back to a fictional scholarship', () => {
  const s = seed(),
    a = input(s)
  a.incomes = []
  saveStudent(s, a, NOW)
  const f = forecast(s, {}, NOW)
  assert.equal(f.assumptions.monthlyIncomeEUR, 0)
  assert.equal(
    f.events.some(e => e.uncertain),
    false
  )
  const b = input(s)
  b.incomes[0].amount = 0
  saveStudent(s, b, NOW)
  assert.equal(
    forecast(s, {}, NOW).events.some(e => e.uncertain),
    false
  )
})

test('month-end rent and income occur once in short months; delays shift future income without counting past payments', () => {
  const now = Date.parse('2027-02-10T10:00:00Z'),
    s = initialState(now)
  s.schedule.rentDay = 31
  s.incomes = [{ id: 'a', label: 'Support', amount: 700, currency: 'CNY', payDay: 31 }]
  const f = forecast(s, { days: 60 }, now)
  assert.equal(f.events.filter(e => e.type === 'Rent' && e.date === '2027-02-28').length, 1)
  assert.equal(f.events.filter(e => e.uncertain && e.date === '2027-02-28').length, 1)
  s.incomes[0].payDay = 1
  const late = forecast(s, { incomeDelay: 14 }, now)
  assert.ok(late.events.some(e => e.uncertain && e.date === '2027-03-15'))
  assert.equal(
    late.events.some(e => e.uncertain && e.date === '2027-02-15'),
    false
  )
  assert.equal(
    late.events.some(e => e.uncertain && e.date === '2027-02-01'),
    false
  )
})

test('affordability excludes all personalized uncertain income, with matching currency rates', () => {
  const s = seed(),
    a = input(s)
  a.incomes = [
    { label: 'Wages', amount: 4000, currency: 'CNY', payDay: 20 },
    { label: 'Support', amount: 500, currency: 'EUR', payDay: 28 },
  ]
  saveStudent(s, a, NOW)
  const base = affordability(s, { amount: 180 }, NOW)
  const f = forecast(s, {}, NOW)
  const expected = f.events.filter(e => e.uncertain).reduce((n, e) => n + e.amount, 0)
  assert.ok(Math.abs(f.endBalance - base.baseline.points.at(-1).balance - expected) < 0.001)
  assert.equal(
    base.baseline.events.some(e => e.uncertain),
    false
  )
  assert.equal(base.baseline.assumptions.monthlyIncomeEUR, 0)
})

test('invalid or stale setup is atomic and cannot silently reduce the protected budget', () => {
  for (const change of [
    a => (a.confirmed = false),
    a => (a.profile.homeCurrency = 'USD'),
    a => (a.profile.semesterEnd = '2026-02-30'),
    a => (a.profile.semesterEnd = '2027-10-11'),
    a => (a.budget.rent = -1),
    a => (a.budget.buffer = 1.001),
    a => (a.schedule.rentDay = 32),
    a => (a.incomes[0].currency = '__proto__'),
    a => (a.incomes[0].payDay = 0),
    a => (a.incomes = Array(6).fill(a.incomes[0])),
    a => (a.profile.name = ''),
  ]) {
    const s = seed(),
      before = structuredClone(s),
      a = input(s)
    change(a)
    assert.throws(() => saveStudent(s, a, NOW))
    assert.deepEqual(s, before)
  }
  const s = seed(),
    a = input(s)
  s.revision++
  assert.throws(
    () => saveStudent(s, a, NOW),
    e => e.code === 'STATE_CHANGED'
  )
})

test('changed tuition must be explicitly verified and older approvals require fresh review', () => {
  const s = seed(),
    draft = prepare(s, { type: 'tuition' }, NOW),
    approval = approveDraft(s, { draftId: draft.id, digest: draft.digest, confirmed: true }, NOW),
    a = input(s)
  a.invoice = { ...s.invoice, amount: 2400 }
  assert.throws(
    () => saveStudent(s, a, NOW),
    e => e.code === 'VERIFY_REQUIRED'
  )
  a.invoiceConfirmed = true
  saveStudent(s, a, NOW)
  assert.equal(s.invoice.amount, 2400)
  assert.equal(s.invoice.verified, true)
  assert.throws(
    () => executeDraft(s, approval, NOW),
    e => e.code === 'STATE_CHANGED'
  )
  assert.equal(s.invoice.paid, false)
})

test('paid invoice stays immutable in setup while other student settings remain editable', () => {
  const s = seed(),
    draft = prepare(s, { type: 'tuition' }, NOW),
    a = approveDraft(s, { draftId: draft.id, digest: draft.digest, confirmed: true }, NOW)
  executeDraft(s, a, NOW)
  const i = input(s)
  i.invoice = { ...s.invoice, amount: 3000 }
  i.invoiceConfirmed = true
  assert.throws(
    () => saveStudent(s, i, NOW),
    e => e.code === 'ALREADY_PAID'
  )
  delete i.invoice
  saveStudent(s, i, NOW)
  assert.equal(s.invoice.paid, true)
  assert.equal(s.invoice.amount, 2300)
})

test('semester plan produces dated review actions and separates income from reliable funds', () => {
  const s = seed()
  saveStudent(s, input(s), NOW)
  const before = structuredClone(s),
    plan = semesterPlan(s, {}, NOW)
  assert.equal(plan.days, 120)
  assert.ok(plan.actions.length > 6)
  assert.ok(plan.actions.some(a => a.id === 'tuition-review'))
  assert.equal(plan.next.id, 'tuition-review')
  assert.ok(plan.actions.some(a => a.income))
  assert.ok(plan.actions.some(a => a.id === 'rent-2026-10-15'))
  assert.ok(plan.conservativeMin < plan.projection.minBalance)
  assert.deepEqual(s, before)
  for (let i = 1; i < plan.actions.length; i++)
    assert.ok(plan.actions[i - 1].date <= plan.actions[i].date)
  assert.ok(plan.tuition.reviewDate <= s.invoice.due)
})

test('semester plans surface missing setup, unverified tuition, unsafe reserves and expired dates', () => {
  const s = seed()
  assert.equal(semesterPlan(s, {}, NOW).next.id, 'setup')
  s.profile.setupComplete = true
  s.invoice.verified = false
  assert.equal(semesterPlan(s, {}, NOW).next.id, 'verify-invoice')
  s.invoice.verified = true
  s.balances.EUR = 100
  assert.ok(semesterPlan(s, {}, NOW).actions.some(a => a.id === 'living-reserve'))
  s.profile.semesterEnd = '2026-10-10'
  assert.equal(semesterPlan(s, {}, NOW).expired, true)
  assert.equal(semesterPlan(s, {}, NOW).next.id, 'setup')
  assert.throws(
    () => forecast(seed(), { days: 181 }, NOW),
    e => e.code === 'INPUT'
  )
})

test('old sessions migrate profile and income defaults once and preserve their ledger', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'finmate-student-migrate-'))
  try {
    const s = seed()
    delete s.profile
    delete s.incomes
    delete s.schedule
    const before = { ...s.balances }
    const file = join(directory, 'state.json')
    await writeFile(file, JSON.stringify({ legacy: { csrf: 'fixture', state: s } }))
    const store = await new Store(file).init()
    assert.equal(store.sessions.legacy.state.revision, 1)
    assert.deepEqual(store.sessions.legacy.state.balances, before)
    await store.persist()
    const again = await new Store(file).init()
    assert.equal(again.sessions.legacy.state.revision, 1)
    assert.ok(verifyAudit(again.sessions.legacy.state.audit))
  } finally {
    await clean(directory)
  }
})

test('offline semester agent reads personalized settings and cannot alter them', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'finmate-student-agent-'))
  try {
    const store = await new Store(join(directory, 'state.json')).init(),
      { id } = await store.create()
    store.sessions[id].state = seed()
    saveStudent(store.sessions[id].state, input(store.sessions[id].state), NOW)
    const result = await runAgent(store, id, 'Plan my semester', {
      now: NOW,
      config: { mode: 'offline' },
    })
    assert.deepEqual(
      result.trace.map(t => t.tool),
      ['get_finances', 'plan_semester']
    )
    assert.ok(result.semester)
    assert.equal(result.draft, null)
    assert.equal(result.semester.profile.name, 'Amina Chen')
    await assert.rejects(
      () => dispatchTool(store, id, 'save_student', {}),
      e => e.code === 'TOOL_FORBIDDEN'
    )
  } finally {
    await clean(directory)
  }
})

test('student API saves profile and income with CSRF, preserves balances and isolates sessions', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'finmate-student-http-'))
  let server
  try {
    const app = await createApp({ path: join(directory, 'state.json') })
    server = app.server
    await new Promise(r => server.listen(0, '127.0.0.1', r))
    const base = `http://127.0.0.1:${server.address().port}`
    const r = await fetch(base + '/api/bootstrap'),
      boot = await r.json(),
      cookie = r.headers.get('set-cookie').split(';')[0]
    const post = (path, body, csrf = boot.csrf) =>
      fetch(base + '/api/' + path, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: base,
          Cookie: cookie,
          'X-FinMate-CSRF': csrf,
        },
        body: JSON.stringify(body),
      })
    const a = input(boot.state)
    a.profile.semesterEnd = new Date(Date.now() + 100 * 86400000).toISOString().slice(0, 10)
    assert.equal((await post('student', a, 'bad')).status, 403)
    const saved = await (await post('student', a)).json()
    assert.equal(saved.state.profile.name, 'Amina Chen')
    assert.deepEqual(saved.state.balances, boot.state.balances)
    assert.equal((await post('student', a)).status, 409)
    const plan = await (await post('semester', {})).json()
    assert.equal(plan.plan.profile.name, 'Amina Chen')
    const other = await (await fetch(base + '/api/bootstrap')).json()
    assert.equal(other.state.profile.name, 'Jamie Li')
  } finally {
    if (server) await new Promise(r => server.close(r))
    await clean(directory)
  }
})
