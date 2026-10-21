import test from 'node:test'
import { request as httpRequest } from 'node:http'
import assert from 'node:assert/strict'
import { randomBytes, randomInt, randomUUID } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import { PostgresStore } from '../backend/postgres-store.mjs'
import { appendAudit, verifyAudit } from '../backend/store.mjs'
import { recordDeposit, setStartingBalances } from '../backend/accounts.mjs'
import { prepare, executeDraft } from '../backend/engine.mjs'
import { setPaymentPin, approveWithPin } from '../backend/security.mjs'
import { createApp } from '../server.mjs'

async function fixture(t) {
  const database = new PGlite()
  t.after(() => database.close())
  const key = randomBytes(32).toString('hex')
  const first = await new PostgresStore(database, key).init()
  const second = await new PostgresStore(database, key).init()
  const { id } = await first.create()
  return { database, key, first, second, id }
}

const deposit = (session, requestId, amount = 100) =>
  recordDeposit(session.state, {
    requestId,
    currency: 'CNY',
    amount,
    label: 'Synthetic deposit',
    confirmed: true,
    baseRevision: session.state.revision,
  })

async function enterBalances(store, id) {
  await store.mutate(id, session =>
    setStartingBalances(session.state, {
      balances: { EUR: 2840, GBP: 1200, CNY: 18600 },
      baseRevision: session.state.revision,
      confirmed: true,
      clearSampleHistory: true,
    })
  )
}

test('hosted sessions are encrypted, isolated and readable from a new worker', async t => {
  const { database, first, second, id } = await fixture(t)
  await enterBalances(first, id)
  const original = await first.get(id)
  assert.deepEqual(await second.get(id), original)
  assert.equal(await first.get('constructor'), undefined)
  const other = await second.create()
  assert.notEqual(other.id, id)
  assert.notEqual(other.session.csrf, original.csrf)
  const { rows } = await database.query('SELECT vault FROM finmate_sessions WHERE id = $1', [id])
  assert.equal(rows[0].vault.includes(original.csrf), false)
  assert.equal(rows[0].vault.includes('Jamie Li'), false)
})

test('concurrent deposits on separate workers credit one request once', async t => {
  const { first, second, id } = await fixture(t)
  await enterBalances(first, id)
  const requestId = randomUUID()
  const results = await Promise.all([
    first.mutate(id, session => deposit(session, requestId)),
    second.mutate(id, session => deposit(session, requestId)),
  ])
  assert.equal(results[0].id, results[1].id)
  const state = (await second.get(id)).state
  assert.equal(state.balances.CNY, 18700)
  assert.equal(Object.keys(state.accounts.deposits).length, 1)
  assert.equal(verifyAudit(state.audit), true)
})

test('concurrent payment execution preserves one receipt and one debit across workers', async t => {
  const { first, second, id } = await fixture(t)
  await enterBalances(first, id)
  const pin = String(randomInt(100000, 1000000))
  await first.mutate(id, session =>
    setPaymentPin(session, {
      newPin: pin,
      repeatPin: pin,
      confirmed: true,
    })
  )
  const draft = await first.mutate(id, session =>
    prepare(session.state, {
      type: 'tuition',
      sourceCurrency: 'CNY',
    })
  )
  const approval = await first.mutate(id, session =>
    approveWithPin(session, {
      draftId: draft.id,
      digest: draft.digest,
      confirmed: true,
      pin,
    })
  )
  const receipts = await Promise.all([
    first.mutate(id, session => executeDraft(session.state, approval)),
    second.mutate(id, session => executeDraft(session.state, approval)),
  ])
  assert.equal(receipts[0].id, receipts[1].id)
  const state = (await first.get(id)).state
  assert.equal(state.balances.CNY, 577.18)
  assert.equal(state.invoice.paid, true)
  assert.equal(state.audit.filter(a => a.title === 'Tuition paid in sandbox').length, 1)
  assert.equal(verifyAudit(state.audit), true)
})

test('hosted PIN failures survive concurrent worker updates and trigger lockout', async t => {
  const { first, second, id } = await fixture(t)
  await first.mutate(id, session =>
    setPaymentPin(session, {
      newPin: '123456',
      repeatPin: '123456',
      confirmed: true,
    })
  )
  const draft = await first.mutate(id, session =>
    prepare(session.state, {
      type: 'tuition',
      sourceCurrency: 'CNY',
    })
  )
  const attempt = store =>
    store.mutate(id, async session => {
      try {
        await approveWithPin(session, {
          draftId: draft.id,
          digest: draft.digest,
          confirmed: true,
          pin: '654321',
        })
        assert.fail('Wrong PIN accepted')
      } catch (error) {
        assert.ok(['PIN_INVALID', 'PIN_LOCKED'].includes(error.code))
        appendAudit(session.state, 'Action blocked', error.message, { code: error.code })
        return error.code
      }
    })
  await Promise.all([first, second, first, second, first].map(attempt))
  const saved = await second.get(id)
  assert.equal(saved.security.failures, 5)
  assert.ok(saved.security.lockedUntil > Date.now())
  assert.equal(Object.keys(saved.state.approvals).length, 0)
})

test('failed database commits and altered audit records cannot publish financial changes', async t => {
  const { database, first, key, id } = await fixture(t)
  const before = await first.get(id)
  const failingDatabase = {
    query(sql, values) {
      if (sql.startsWith('UPDATE finmate_sessions'))
        throw new Error('Synthetic unavailable database')
      return database.query(sql, values)
    },
  }
  const failing = new PostgresStore(failingDatabase, key)
  await assert.rejects(
    failing.mutate(id, session => {
      session.state.balances.EUR = 1
    })
  )
  assert.deepEqual(await first.get(id), before)
  await assert.rejects(
    first.mutate(id, session => {
      session.state.audit[0].title = 'Altered'
    }),
    { code: 'AUDIT_INTEGRITY' }
  )
  assert.deepEqual(await first.get(id), before)
  const wrongKey = new PostgresStore(database, randomBytes(32).toString('hex'))
  await assert.rejects(wrongKey.get(id), { code: 'VAULT_INTEGRITY' })
})

test('hosted rate limits are shared across workers and reset after cooldown', async t => {
  const { database, first, second } = await fixture(t)
  const results = await Promise.allSettled(
    [first, second, first, second].map(store => store.consumeLimit('agent', 'synthetic-client', 3))
  )
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 3)
  const failed = results.find(r => r.status === 'rejected')
  assert.equal(failed.reason.code, 'RATE_LIMIT')
  await database.query(
    "UPDATE finmate_request_limits SET resets_at = CURRENT_TIMESTAMP - INTERVAL '1 minute'"
  )
  await first.consumeLimit('agent', 'synthetic-client', 3)
  await first.consumeLimit('agent-day', 'site', 1, 86400)
  await assert.rejects(second.consumeLimit('agent-day', 'site', 1, 86400), { code: 'RATE_LIMIT' })
  const rows = (await database.query('SELECT resets_at FROM finmate_request_limits')).rows
  assert.ok(rows.some(row => new Date(row.resets_at).getTime() > Date.now() + 86300000))
})

async function send(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      url,
      { method: options.method || 'GET', headers: options.headers },
      res => {
        const chunks = []
        res.on('data', chunk => chunks.push(chunk))
        res.on('end', () =>
          resolve({
            status: res.statusCode,
            headers: {
              get: name =>
                Array.isArray(res.headers[name]) ? res.headers[name].join(', ') : res.headers[name],
            },
            json: async () => JSON.parse(Buffer.concat(chunks).toString('utf8')),
          })
        )
      }
    )
    req.on('error', reject)
    req.end(options.body)
  })
}

test('hosted HTTP uses secure cookies and rejects wrong hosts and origins across workers', async t => {
  const { first, second } = await fixture(t)
  const options = { publicOrigins: ['https://finmate.example'], hosted: true }
  const apps = await Promise.all([first, second].map(store => createApp({ ...options, store })))
  for (const app of apps) {
    await new Promise(r => app.server.listen(0, '127.0.0.1', r))
    t.after(() => new Promise(r => app.server.close(r)))
  }
  apps[1].server.removeAllListeners('request')
  apps[1].server.on('request', async (req, res) => {
    if (req.method === 'POST') {
      const chunks = []
      for await (const chunk of req) chunks.push(chunk)
      req.body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    }
    await apps[1].handler(req, res)
  })
  const bases = apps.map(app => `http://127.0.0.1:${app.server.address().port}`)
  const initial = await send(bases[0] + '/api/bootstrap', { headers: { Host: 'finmate.example' } })
  assert.equal(initial.status, 200)
  assert.match(initial.headers.get('set-cookie'), /; Secure/)
  const cookie = initial.headers.get('set-cookie').split(';')[0]
  const boot = await initial.json()
  const headers = {
    Host: 'finmate.example',
    Cookie: cookie,
    Origin: 'https://finmate.example',
    'Content-Type': 'application/json',
    'X-FinMate-CSRF': boot.csrf,
  }
  const read = await send(bases[1] + '/api/state', { headers })
  assert.deepEqual((await read.json()).state, boot.state)
  const badOrigin = await send(bases[1] + '/api/prepare', {
    method: 'POST',
    headers: { ...headers, Origin: 'https://attacker.example' },
    body: '{}',
  })
  assert.equal(badOrigin.status, 403)
  const badHost = await send(bases[1] + '/api/state', {
    headers: { ...headers, Host: 'attacker.example' },
  })
  assert.equal(badHost.status, 403)
  const valid = await send(bases[1] + '/api/tuition/compare', {
    method: 'POST',
    headers,
    body: JSON.stringify({ sourceCurrency: 'CNY' }),
  })
  assert.equal(valid.status, 200)
  const hidden = await send(bases[1] + '/.env', { headers })
  assert.equal(hidden.status, 404)
})
