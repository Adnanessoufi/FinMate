import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join, dirname, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { initialState, Store, verifyAudit, publicState } from '../backend/store.mjs'
import { setStartingBalances, recordDeposit, accountStatus } from '../backend/accounts.mjs'
import { prepare, approveDraft, executeDraft } from '../backend/engine.mjs'
import { forecast } from '../backend/forecast.mjs'
import { dispatchTool, runAgent } from '../backend/agent.mjs'
import { createApp } from '../server.mjs'

const NOW = Date.parse('2026-10-11T10:00:00Z'),
  seed = () => initialState(NOW)
const opening = (s, balances = { EUR: 3000, GBP: 500, CNY: 20000 }) => ({
  balances,
  baseRevision: s.revision,
  confirmed: true,
  clearSampleHistory: true,
})
const deposit = s => ({
  currency: 'EUR',
  amount: 250,
  label: 'Family support',
  requestId: randomUUID(),
  baseRevision: s.revision,
  confirmed: true,
})
const code = expected => e => e.code === expected

async function directory(fn) {
  const d = await mkdtemp(join(tmpdir(), 'finmate-accounts-'))
  try {
    await fn(d)
  } finally {
    assert.equal(dirname(resolve(d)), resolve(tmpdir()))
    await rm(d, { recursive: true, force: true })
  }
}

async function httpApp(fn) {
  await directory(async d => {
    const { server, store } = await createApp({ path: join(d, 'state.json') })
    await new Promise(r => server.listen(0, '127.0.0.1', r))
    const base = `http://127.0.0.1:${server.address().port}`
    try {
      const response = await fetch(base + '/api/bootstrap'),
        boot = await response.json(),
        cookie = response.headers.get('set-cookie').split(';')[0]
      const post = async (path, input, csrf = boot.csrf) => {
        const r = await fetch(base + '/api/' + path, {
          method: 'POST',
          headers: {
            Cookie: cookie,
            Origin: base,
            'Content-Type': 'application/json',
            'X-FinMate-CSRF': csrf,
          },
          body: JSON.stringify(input),
        })
        return { status: r.status, body: await r.json() }
      }
      await fn({ base, boot, cookie, post, store, d })
    } finally {
      await new Promise(r => server.close(r))
    }
  })
}

test('opening balances replace examples, preserve imported history and remove only the sample income', () => {
  const s = seed(),
    invoice = { ...s.invoice }
  s.transactions.push({
    id: 'import',
    date: '2026-10-10',
    description: 'My statement',
    amount: 20,
    currency: 'EUR',
    imported: true,
  })
  s.incomes.push({ id: 'own-income', label: 'Wages', amount: 100, currency: 'EUR', payDay: 20 })
  setStartingBalances(s, opening(s, { EUR: 0, GBP: 20.25, CNY: 1000 }), NOW)
  assert.deepEqual(s.balances, { EUR: 0, GBP: 20.25, CNY: 1000 })
  assert.equal(s.accounts.origin, 'entered')
  assert.deepEqual(s.invoice, invoice)
  assert.equal(s.transactions.length, 1)
  assert.equal(s.transactions[0].id, 'import')
  assert.deepEqual(
    s.incomes.map(i => i.id),
    ['own-income']
  )
  assert.equal(forecast(s, {}, NOW).assumptions.monthlyIncomeEUR, 100)
  assert.equal(accountStatus(s).bankVerified, false)
  assert.ok(verifyAudit(s.audit))
})

test('keeping sample history never replays its amounts into the entered snapshot', () => {
  const s = seed(),
    transactions = structuredClone(s.transactions)
  const i = opening(s, { EUR: 100, GBP: 0, CNY: 0 })
  i.clearSampleHistory = false
  setStartingBalances(s, i, NOW)
  assert.deepEqual(s.transactions, transactions)
  assert.equal(s.incomes[0].amount, 900)
  assert.equal(forecast(s, {}, NOW).scenarioStart, 100)
})

test('malformed, unconfirmed and stale opening balances leave all account data unchanged', () => {
  for (const change of [
    i => (i.confirmed = false),
    i => i.baseRevision++,
    i => (i.balances.EUR = -1),
    i => (i.balances.EUR = 1.001),
    i => (i.balances.EUR = '100'),
    i => (i.balances.EUR = true),
    i => (i.balances.CNY = Infinity),
    i => (i.balances.EUR = 1000001),
    i => delete i.balances.GBP,
    i => (i.balances.USD = 5),
    i => (i.balances = null),
    i => delete i.clearSampleHistory,
  ]) {
    const s = seed(),
      before = structuredClone(s),
      i = opening(s)
    change(i)
    assert.throws(() => setStartingBalances(s, i, NOW))
    assert.deepEqual(s, before)
  }
})

test('changing starting balances invalidates quotes and revokes pending approvals', () => {
  const s = seed(),
    d = prepare(s, { type: 'tuition' }, NOW),
    a = approveDraft(s, { draftId: d.id, digest: d.digest, confirmed: true }, NOW)
  setStartingBalances(s, opening(s), NOW)
  assert.equal(s.approvals[a.approvalId].revoked, true)
  assert.throws(() => executeDraft(s, a, NOW), code('APPROVAL_REQUIRED'))
  assert.equal(s.invoice.paid, false)
  assert.deepEqual(s.balances, { EUR: 3000, GBP: 500, CNY: 20000 })
})

test('simulated deposits credit one selected account with linked transaction and audit receipt', () => {
  const s = seed()
  setStartingBalances(s, opening(s), NOW)
  const before = { ...s.balances },
    i = deposit(s),
    receipt = recordDeposit(s, i, NOW)
  assert.equal(s.balances.EUR, before.EUR + 250)
  assert.equal(s.balances.CNY, before.CNY)
  assert.equal(s.balances.GBP, before.GBP)
  assert.equal(receipt.simulation, true)
  assert.equal(receipt.bankVerified, false)
  assert.equal(s.transactions[0].id, receipt.transactionId)
  assert.equal(s.transactions[0].category, 'Simulated deposit')
  assert.equal(s.audit.at(-1).id, receipt.auditId)
  assert.ok(verifyAudit(s.audit))
})

test('deposit retries return one receipt even after the first credit changes the revision', () => {
  const s = seed()
  setStartingBalances(s, opening(s), NOW)
  const i = deposit(s),
    r = recordDeposit(s, i, NOW),
    before = structuredClone(s),
    again = recordDeposit(s, i, NOW + 100)
  assert.equal(again.id, r.id)
  assert.equal(again.replayed, true)
  assert.deepEqual(s, before)
  assert.throws(() => recordDeposit(s, { ...i, amount: 251 }, NOW), code('DEPOSIT_MISMATCH'))
})

test('deposits reject bad amounts, identifiers, currencies, consent and stale account versions atomically', () => {
  const uninitialized = seed()
  assert.throws(
    () => recordDeposit(uninitialized, deposit(uninitialized), NOW),
    code('BALANCE_SETUP')
  )
  for (const change of [
    i => (i.amount = 0),
    i => (i.amount = -1),
    i => (i.amount = 1.001),
    i => (i.amount = '100'),
    i => (i.currency = 'USD'),
    i => (i.label = ''),
    i => (i.label = 'x'.repeat(81)),
    i => (i.requestId = 'constructor'),
    i => (i.requestId = {}),
    i => (i.confirmed = false),
    i => i.baseRevision--,
  ]) {
    const s = seed()
    setStartingBalances(s, opening(s), NOW)
    const before = structuredClone(s),
      i = deposit(s)
    change(i)
    assert.throws(() => recordDeposit(s, i, NOW))
    assert.deepEqual(s, before)
  }
  const s = seed()
  setStartingBalances(s, opening(s, { EUR: 999999, GBP: 0, CNY: 0 }), NOW)
  assert.throws(() => recordDeposit(s, deposit(s), NOW), code('DEPOSIT_LIMIT'))
  assert.equal(s.balances.EUR, 999999)
})

test('deposit changes revoke pending payment approvals; starting snapshots lock after account activity', () => {
  const s = seed()
  setStartingBalances(s, opening(s), NOW)
  const d = prepare(s, { type: 'tuition' }, NOW),
    a = approveDraft(s, { draftId: d.id, digest: d.digest, confirmed: true }, NOW)
  recordDeposit(s, deposit(s), NOW)
  assert.throws(() => executeDraft(s, a, NOW), code('APPROVAL_REQUIRED'))
  assert.equal(accountStatus(s).canEditStartingBalances, false)
  assert.throws(() => setStartingBalances(s, opening(s), NOW), code('BALANCE_HISTORY'))
  const paid = seed()
  const draft = prepare(paid, { type: 'tuition' }, NOW),
    approval = approveDraft(paid, { draftId: draft.id, digest: draft.digest, confirmed: true }, NOW)
  executeDraft(paid, approval, NOW)
  assert.throws(() => setStartingBalances(paid, opening(paid), NOW), code('BALANCE_HISTORY'))
})

test('agent receives source labels but cannot set balances or credit deposits', async () => {
  const state = seed()
  setStartingBalances(state, opening(state), NOW)
  recordDeposit(state, deposit(state), NOW)
  const session = { state },
    store = { sessions: { fixture: session }, mutate: async (id, fn) => fn(session) }
  const finances = await dispatchTool(store, 'fixture', 'get_finances', {}, NOW)
  assert.equal(finances.accounts.origin, 'entered')
  assert.equal(finances.accounts.bankConnected, false)
  assert.equal(Object.hasOwn(finances.accounts, 'deposits'), false)
  for (const tool of ['set_starting_balances', 'record_deposit', 'add_funds'])
    await assert.rejects(
      () => dispatchTool(store, 'fixture', tool, {}, NOW),
      code('TOOL_FORBIDDEN')
    )
  const before = { ...state.balances },
    answer = await runAgent(store, 'fixture', 'Add 500 EUR to my balance', {
      config: { mode: 'offline' },
    })
  assert.match(answer.answer, /cannot credit/i)
  assert.deepEqual(state.balances, before)
  assert.deepEqual(
    answer.trace.map(t => t.tool),
    ['get_finances']
  )
})

test('legacy accounts migrate source metadata while preserving balances, imports, approvals and audit integrity', async () =>
  directory(async d => {
    const s = seed()
    delete s.accounts
    for (const t of s.transactions) delete t.sample
    s.transactions.push({
      id: 'import',
      imported: true,
      currency: 'EUR',
      amount: 30,
      date: '2026-10-10',
      description: 'Personal',
    })
    const before = { ...s.balances },
      audit = structuredClone(s.audit),
      path = join(d, 'state.json')
    await writeFile(path, JSON.stringify({ legacy: { state: s, csrf: 'fixture' } }))
    const store = await new Store(path).init()
    assert.deepEqual(store.sessions.legacy.state.balances, before)
    assert.deepEqual(store.sessions.legacy.state.audit, audit)
    assert.equal(store.sessions.legacy.state.accounts.origin, 'sample')
    assert.equal(store.sessions.legacy.state.transactions.filter(t => t.sample).length, 3)
    assert.equal(store.sessions.legacy.state.transactions.at(-1).sample, undefined)
  }))

test('account HTTP routes enforce consent, CSRF, strict fields, session isolation and encrypted persistence', async () =>
  httpApp(async c => {
    const input = opening(c.boot.state)
    assert.equal((await c.post('accounts/starting-balances', input, 'wrong')).status, 403)
    assert.equal(
      (await c.post('accounts/starting-balances', { ...input, execute: true })).body.code,
      'INPUT_KEYS'
    )
    const start = await c.post('accounts/starting-balances', input)
    assert.equal(start.status, 200)
    const i = deposit(start.body.state),
      credited = await c.post('accounts/deposit', i)
    assert.equal(credited.status, 200)
    const again = await c.post('accounts/deposit', i)
    assert.equal(again.body.receipt.id, credited.body.receipt.id)
    assert.equal(again.body.receipt.replayed, true)
    assert.equal(again.body.state.accounts.depositCount, 1)
    assert.equal(Object.hasOwn(again.body.state.accounts, 'deposits'), false)
    const other = await (await fetch(c.base + '/api/bootstrap')).json()
    assert.equal(other.state.accounts.origin, 'sample')
    assert.deepEqual(other.state.balances, c.boot.state.balances)
    const exported = await (
      await fetch(c.base + '/api/export', { headers: { Cookie: c.cookie } })
    ).json()
    assert.equal(exported.depositReceipts.length, 1)
    assert.equal(exported.depositReceipts[0].id, credited.body.receipt.id)
    assert.equal(exported.depositReceipts[0].simulation, true)
    assert.equal(Object.hasOwn(exported.depositReceipts[0], 'fingerprint'), false)
    const restored = await new Store(join(c.d, 'state.json')).init()
    const own = Object.values(restored.sessions).find(s => s.csrf === c.boot.csrf)
    assert.equal(own.state.balances.EUR, 3250)
    assert.equal(accountStatus(own.state).depositCount, 1)
    assert.ok(verifyAudit(own.state.audit))
  }))

test('concurrent deposit requests credit once and permanent persistence failures roll back credits', async () =>
  httpApp(async c => {
    const start = (await c.post('accounts/starting-balances', opening(c.boot.state))).body
    const i = deposit(start.state),
      results = await Promise.all([c.post('accounts/deposit', i), c.post('accounts/deposit', i)])
    assert.ok(results.every(r => r.status === 200))
    assert.equal(results[0].body.receipt.id, results[1].body.receipt.id)
    const own = Object.values(c.store.sessions).find(s => s.csrf === c.boot.csrf)
    assert.equal(own.state.balances.EUR, 3250)
    assert.equal(own.state.transactions.filter(t => t.category === 'Simulated deposit').length, 1)
    c.store.replaceFile = async () => {
      const e = new Error('test storage failure')
      e.code = 'EIO'
      throw e
    }
    const previous = structuredClone(own.state),
      next = deposit(own.state)
    await assert.rejects(
      () => c.store.mutate(c.cookie.split('=')[1], s => recordDeposit(s.state, next)),
      e => e.code === 'EIO'
    )
    assert.deepEqual(c.store.sessions[c.cookie.split('=')[1]].state, previous)
  }))
