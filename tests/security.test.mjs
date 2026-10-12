import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile, writeFile, rename } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { Store, initialState, digest, verifyAudit } from '../backend/store.mjs'
import { sealVault } from '../backend/vault.mjs'
import {
  securityDefaults,
  setPaymentPin,
  approveWithPin,
  securityStatus,
  RateLimiter,
  validateJsonObject,
} from '../backend/security.mjs'
import { prepare, executeDraft, validateDraft } from '../backend/engine.mjs'
import { dispatchTool, runAgent } from '../backend/agent.mjs'
import { createApp } from '../server.mjs'

const NOW = Date.parse('2026-10-11T10:00:00Z'),
  PIN = '764928',
  NEXT_PIN = '827465'
const session = () => ({
  csrf: 'synthetic',
  security: securityDefaults(),
  state: initialState(NOW),
})
const setup = (s, pin = PIN, extra = {}) =>
  setPaymentPin(s, { newPin: pin, repeatPin: pin, confirmed: true, ...extra }, NOW)

async function clean(directory) {
  assert.equal(dirname(resolve(directory)), resolve(tmpdir()))
  await rm(directory, { recursive: true, force: true })
}

async function withDirectory(fn) {
  const directory = await mkdtemp(join(tmpdir(), 'finmate-security-'))
  try {
    await fn(directory)
  } finally {
    await clean(directory)
  }
}

const errorCode = code => e => e.code === code

async function withApp(fn, options = {}) {
  await withDirectory(async directory => {
    const { server, store } = await createApp({
      path: join(directory, 'sessions.json'),
      ...options,
    })
    await new Promise(r => server.listen(0, '127.0.0.1', r))
    const base = `http://127.0.0.1:${server.address().port}`
    try {
      const response = await fetch(base + '/api/bootstrap'),
        boot = await response.json(),
        cookie = response.headers.get('set-cookie').split(';')[0]
      const client = {
        base,
        cookie,
        csrf: boot.csrf,
        boot,
        post: async (path, input, headers = {}) => {
          const r = await fetch(base + '/api/' + path, {
            method: 'POST',
            headers: {
              Cookie: cookie,
              Origin: base,
              'Content-Type': 'application/json',
              'X-FinMate-CSRF': client.csrf,
              ...headers,
            },
            body: typeof input === 'string' ? input : JSON.stringify(input),
          })
          const body = await r.json()
          if (body.csrf) client.csrf = body.csrf
          return { status: r.status, body, headers: r.headers }
        },
        get: path => fetch(base + '/api/' + path, { headers: { Cookie: cookie } }),
      }
      await fn(client, store, directory)
    } finally {
      await new Promise(r => server.close(r))
    }
  })
}

test('vault encryption hides profile, balances, CSRF and PIN material and survives restart', async () =>
  withDirectory(async directory => {
    const path = join(directory, 'state.json'),
      store = await new Store(path).init(),
      { id } = await store.create()
    await store.mutate(id, s => {
      s.state.profile.name = 'Private Student'
    })
    await store.mutate(id, s => setup(s))
    const raw = await readFile(path, 'utf8'),
      envelope = JSON.parse(raw)
    assert.equal(envelope.algorithm, 'AES-256-GCM')
    for (const value of [
      'Private Student',
      id,
      store.sessions[id].csrf,
      PIN,
      store.sessions[id].security.pin.hash,
    ])
      assert.equal(raw.includes(value), false)
    const restored = await new Store(path).init()
    assert.equal(restored.sessions[id].state.profile.name, 'Private Student')
    assert.equal(securityStatus(restored.sessions[id]).hasPin, true)
    const iv = envelope.iv
    await restored.persist()
    assert.notEqual(JSON.parse(await readFile(path, 'utf8')).iv, iv)
  }))

test('legacy plaintext is migrated atomically without changing balances or audit evidence', async () =>
  withDirectory(async directory => {
    const path = join(directory, 'state.json'),
      old = { fixture: { csrf: 'old-csrf', state: initialState(NOW), createdAt: NOW } },
      before = structuredClone(old.fixture.state)
    await writeFile(path, JSON.stringify(old))
    const store = await new Store(path).init()
    assert.deepEqual(store.sessions.fixture.state, before)
    assert.equal(store.sessions.fixture.csrf, 'old-csrf')
    assert.equal(JSON.parse(await readFile(path, 'utf8')).format, 'finmate-vault-v1')
    assert.ok(verifyAudit(store.sessions.fixture.state.audit))
  }))

test('ciphertext tampering, wrong keys and missing keys fail closed without overwriting the vault', async () =>
  withDirectory(async directory => {
    const path = join(directory, 'state.json'),
      store = await new Store(path).init()
    await store.create()
    const original = await readFile(path, 'utf8')
    await assert.rejects(
      new Store(path, { storageKey: 'ab'.repeat(32) }).init(),
      errorCode('VAULT_INTEGRITY')
    )
    assert.equal(await readFile(path, 'utf8'), original)
    const tampered = JSON.parse(original),
      bytes = Buffer.from(tampered.ciphertext, 'base64')
    bytes[0] ^= 1
    tampered.ciphertext = bytes.toString('base64')
    await writeFile(path, JSON.stringify(tampered))
    await assert.rejects(new Store(path).init(), errorCode('VAULT_INTEGRITY'))
    await writeFile(path, original)
    await rename(path + '.key', path + '.key.saved')
    await assert.rejects(new Store(path).init(), errorCode('VAULT_KEY_MISSING'))
    assert.equal(await readFile(path, 'utf8'), original)
  }))

test('invalid storage keys and damaged audit evidence never silently reset financial data', async () =>
  withDirectory(async directory => {
    const path = join(directory, 'state.json')
    await assert.rejects(new Store(path, { storageKey: 'short' }).init(), errorCode('VAULT_KEY'))
    const store = await new Store(path).init(),
      { id } = await store.create()
    store.sessions[id].state.audit[0].description = 'changed'
    await writeFile(path, sealVault(store.sessions, store.key))
    const raw = await readFile(path, 'utf8')
    await assert.rejects(new Store(path).init(), errorCode('AUDIT_INTEGRITY'))
    assert.equal(await readFile(path, 'utf8'), raw)
  }))

test('uncommitted account changes stay invisible while persistence is in progress', async () =>
  withDirectory(async directory => {
    const path = join(directory, 'state.json'),
      store = await new Store(path).init(),
      { id } = await store.create(),
      before = store.sessions[id].state.balances.EUR
    let release, enter
    const entered = new Promise(r => (enter = r)),
      gate = new Promise(r => (release = r))
    store.replaceFile = async (...args) => {
      enter()
      await gate
      return rename(...args)
    }
    const pending = store.mutate(id, s => {
      s.state.balances.EUR = 1
    })
    await entered
    assert.equal(store.sessions[id].state.balances.EUR, before)
    release()
    await pending
    assert.equal(store.sessions[id].state.balances.EUR, 1)
  }))

test('audit tampering before or during a mutation blocks account changes', async () =>
  withDirectory(async directory => {
    const store = await new Store(join(directory, 'state.json')).init(),
      { id } = await store.create(),
      before = store.sessions[id].state.balances.EUR
    await assert.rejects(
      store.mutate(id, s => {
        s.state.balances.EUR = 0
        s.state.audit[0].description = 'changed'
      }),
      errorCode('AUDIT_INTEGRITY')
    )
    assert.equal(store.sessions[id].state.balances.EUR, before)
    store.sessions[id].state.audit[0].description = 'changed'
    let called = false
    await assert.rejects(
      store.mutate(id, () => {
        called = true
      }),
      errorCode('AUDIT_INTEGRITY')
    )
    assert.equal(called, false)
  }))

test('PIN setup validates confirmation, repeat entry and format without approving a payment', async () => {
  const s = session()
  for (const input of [
    { newPin: PIN, repeatPin: PIN, confirmed: false },
    { newPin: '123', repeatPin: '123', confirmed: true },
    { newPin: PIN, repeatPin: NEXT_PIN, confirmed: true },
  ])
    await assert.rejects(setPaymentPin(s, input, NOW), errorCode('PIN_FORMAT'))
  const before = { ...s.state.balances },
    oldCsrf = s.csrf
  await setup(s)
  assert.notEqual(s.csrf, oldCsrf)
  assert.equal(s.security.pin.hash.length, 64)
  assert.notEqual(s.security.pin.hash, digest(PIN))
  assert.equal(JSON.stringify(s.state.audit).includes(PIN), false)
  assert.deepEqual(s.state.balances, before)
  assert.equal(Object.keys(s.state.approvals).length, 0)
})

test('every approval requires the current PIN and binds it to the exact reviewed draft', async () => {
  const s = session()
  let d = prepare(s.state, { type: 'tuition' }, NOW)
  await assert.rejects(
    approveWithPin(s, { draftId: d.id, digest: d.digest, confirmed: true }, NOW),
    errorCode('PIN_SETUP')
  )
  await setup(s)
  d = prepare(s.state, { type: 'tuition' }, NOW)
  await assert.rejects(
    approveWithPin(s, { draftId: d.id, digest: 'forged', confirmed: true, pin: PIN }, NOW),
    errorCode('PLAN_MISMATCH')
  )
  await assert.rejects(
    approveWithPin(s, { draftId: d.id, digest: d.digest, confirmed: true, pin: NEXT_PIN }, NOW),
    errorCode('PIN_INVALID')
  )
  await assert.rejects(
    approveWithPin(s, { draftId: d.id, digest: d.digest, confirmed: false, pin: PIN }, NOW),
    errorCode('APPROVAL_REQUIRED')
  )
  const approval = await approveWithPin(
    s,
    { draftId: d.id, digest: d.digest, confirmed: true, pin: PIN },
    NOW
  )
  const receipt = executeDraft(s.state, approval, NOW)
  assert.equal(receipt.status, 'completed')
  assert.equal(JSON.stringify(receipt).includes(PIN), false)
})

test('five incorrect PIN attempts lock approvals even with the correct PIN until cooldown expires', async () => {
  const s = session()
  await setup(s)
  let d = prepare(s.state, { type: 'tuition' }, NOW)
  for (let i = 1; i <= 5; i++)
    await assert.rejects(
      approveWithPin(s, { draftId: d.id, digest: d.digest, confirmed: true, pin: NEXT_PIN }, NOW),
      errorCode(i === 5 ? 'PIN_LOCKED' : 'PIN_INVALID')
    )
  await assert.rejects(
    approveWithPin(s, { draftId: d.id, digest: d.digest, confirmed: true, pin: PIN }, NOW),
    errorCode('PIN_LOCKED')
  )
  const later = NOW + 300001
  d = prepare(s.state, { type: 'tuition' }, later)
  const approval = await approveWithPin(
    s,
    { draftId: d.id, digest: d.digest, confirmed: true, pin: PIN },
    later
  )
  assert.ok(approval.token)
  assert.equal(s.security.failures, 0)
})

test('changing a PIN requires the old PIN, rotates CSRF and revokes existing approvals', async () => {
  const s = session()
  await setup(s)
  const d = prepare(s.state, { type: 'tuition' }, NOW),
    approval = await approveWithPin(
      s,
      { draftId: d.id, digest: d.digest, confirmed: true, pin: PIN },
      NOW
    ),
    csrf = s.csrf
  await assert.rejects(setup(s, NEXT_PIN, { currentPin: '000000' }), errorCode('PIN_INVALID'))
  await setup(s, NEXT_PIN, { currentPin: PIN })
  assert.notEqual(csrf, s.csrf)
  assert.equal(s.state.approvals[approval.approvalId].revoked, true)
  assert.throws(() => executeDraft(s.state, approval, NOW), errorCode('APPROVAL_REQUIRED'))
  const fresh = prepare(s.state, { type: 'tuition' }, NOW)
  await assert.rejects(
    approveWithPin(s, { draftId: fresh.id, digest: fresh.digest, confirmed: true, pin: PIN }, NOW),
    errorCode('PIN_INVALID')
  )
  assert.ok(
    await approveWithPin(
      s,
      { draftId: fresh.id, digest: fresh.digest, confirmed: true, pin: NEXT_PIN },
      NOW
    )
  )
})

test('agent rejects unknown credential tools, unsupported arguments, missing fields and wrong types', async () => {
  const s = session(),
    store = { mutate: async (id, fn) => fn(s) }
  for (const [name, args] of [
    ['set_payment_pin', {}],
    ['approve_with_pin', {}],
  ])
    await assert.rejects(dispatchTool(store, 'fixture', name, args), errorCode('TOOL_FORBIDDEN'))
  for (const [name, args] of [
    ['forecast', { incomeDelay: '14' }],
    ['forecast', { incomeDelay: 1.5 }],
    ['compare_transfer', { amount: 100, from: 'USD', to: 'EUR' }],
    ['compare_transfer', { amount: 100, from: 'CNY' }],
    ['get_finances', { pin: PIN }],
    ['compare_funding', { backupCurrencies: ['EUR', 'GBP', 'CNY'] }],
    ['get_finances', null],
  ])
    await assert.rejects(dispatchTool(store, 'fixture', name, args), errorCode('TOOL_ARGUMENTS'))
  await setup(s)
  const result = await dispatchTool(store, 'fixture', 'get_finances', {})
  assert.equal(JSON.stringify(result).includes(s.security.pin.hash), false)
  assert.equal(Object.hasOwn(result, 'security'), false)
})

test('credential-looking PINs and API keys are refused before any model request or chat storage', async () => {
  const s = session(),
    store = { sessions: { fixture: s } }
  let called = false
  for (const message of [`My payment PIN is ${PIN}`, 'My API key: sk-syntheticnotarealkey'])
    await assert.rejects(
      runAgent(store, 'fixture', message, {
        config: { mode: 'live', model: 'fixture' },
        fetchImpl: async () => {
          called = true
        },
      }),
      errorCode('CHAT_SECRET')
    )
  assert.equal(called, false)
  assert.equal(s.state.chat.length, 0)
})

test('malformed JSON shapes and dangerous nested object keys are rejected', () => {
  for (const input of [null, [], 1, 'text'])
    assert.throws(() => validateJsonObject(input), errorCode('JSON_OBJECT'))
  assert.throws(
    () => validateJsonObject(JSON.parse('{"profile":{"__proto__":{"admin":true}}}')),
    errorCode('JSON_KEYS')
  )
  let deep = {}
  for (let i = 0; i < 10; i++) deep = { nested: deep }
  assert.throws(() => validateJsonObject(deep), errorCode('JSON_SHAPE'))
  assert.deepEqual(validateJsonObject({ amount: 10, sourceCurrency: 'EUR' }), {
    amount: 10,
    sourceCurrency: 'EUR',
  })
})

test('rate limits reset after cooldown and do not trust user-supplied forwarding headers', async () => {
  let now = 0
  const limiter = new RateLimiter({ limit: 2, windowMs: 100, now: () => now })
  limiter.consume('client')
  limiter.consume('client')
  assert.throws(() => limiter.consume('client'), errorCode('RATE_LIMIT'))
  now = 101
  limiter.consume('client')
  await withApp(
    async c => {
      const first = await c.post(
        'agent',
        { message: 'My PIN is ' + PIN },
        { 'X-Forwarded-For': '1.2.3.4' }
      )
      assert.equal(first.body.code, 'CHAT_SECRET')
      const second = await c.post(
        'agent',
        { message: 'My PIN is ' + PIN },
        { 'X-Forwarded-For': '9.8.7.6' }
      )
      assert.equal(second.status, 429)
      assert.equal(second.body.code, 'RATE_LIMIT')
      assert.ok(Number(second.headers.get('retry-after')) > 0)
    },
    { rateLimits: { agent: 1 } }
  )
})

test('HTTP rejects cross-site access, wrong JSON roots and unknown fields before changing accounts', async () =>
  withApp(async c => {
    assert.equal(
      (await fetch(c.base + '/api/bootstrap', { headers: { 'Sec-Fetch-Site': 'cross-site' } }))
        .status,
      403
    )
    for (const input of ['null', '[]', '{"type":"tuition","__proto__":{}}']) {
      const r = await c.post('prepare', input)
      assert.equal(r.status, 400)
    }
    const unknown = await c.post('prepare', { type: 'tuition', approve: true })
    assert.equal(unknown.body.code, 'INPUT_KEYS')
    assert.equal(
      (await c.post('prepare', { type: 'tuition' }, { 'Content-Type': 'application/json-evil' }))
        .status,
      415
    )
    const state = await (await c.get('state')).json()
    assert.deepEqual(state.state.balances, c.boot.state.balances)
    assert.equal(state.state.auditIntegrity, true)
  }))

test('HTTP approval enforces PIN, persists failed attempts and keeps credentials out of exports', async () =>
  withApp(async (c, store, path) => {
    let d = (await c.post('prepare', { type: 'tuition' })).body.draft
    assert.equal(
      (await c.post('approve', { draftId: d.id, digest: d.digest, confirmed: true })).body.code,
      'PIN_SETUP'
    )
    const oldCsrf = c.csrf
    const configured = await c.post('security/pin', {
      newPin: PIN,
      repeatPin: PIN,
      confirmed: true,
    })
    assert.equal(configured.status, 200)
    assert.equal(Object.hasOwn(configured.body.security, 'pin'), false)
    assert.equal(
      (await c.post('prepare', { type: 'tuition' }, { 'X-FinMate-CSRF': oldCsrf })).status,
      403
    )
    d = (await c.post('prepare', { type: 'tuition' })).body.draft
    const wrong = await c.post('approve', {
      draftId: d.id,
      digest: d.digest,
      confirmed: true,
      pin: NEXT_PIN,
    })
    assert.equal(wrong.body.code, 'PIN_INVALID')
    const restored = await new Store(join(path, 'sessions.json')).init(),
      own = Object.values(restored.sessions).find(s => s.csrf === c.csrf)
    assert.equal(own.security.failures, 1)
    const approved = await c.post('approve', {
      draftId: d.id,
      digest: d.digest,
      confirmed: true,
      pin: PIN,
    })
    assert.equal(approved.status, 200)
    assert.equal((await c.post('execute', approved.body.approval)).status, 200)
    const exported = await (await c.get('export')).json()
    for (const value of [PIN, NEXT_PIN, own.security.pin.hash, own.security.pin.salt, c.csrf])
      assert.equal(JSON.stringify(exported).includes(value), false)
    assert.ok(verifyAudit(exported.audit))
    assert.equal(exported.receipts.length, 1)
    const vaultText = await readFile(join(path, 'sessions.json'), 'utf8')
    assert.equal(vaultText.includes(PIN), false)
    assert.equal(vaultText.includes(c.cookie.slice('finmate_session='.length)), false)
  }))

test('HTTP headers block framing and unexpected permission access; integrity failures stop reads and writes', async () =>
  withApp(async (c, store) => {
    const response = await c.get('state')
    assert.equal(response.headers.get('x-frame-options'), 'DENY')
    assert.match(response.headers.get('permissions-policy'), /camera=\(\)/)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    const own = Object.values(store.sessions).find(s => s.csrf === c.csrf)
    own.state.audit[0].description = 'corrupted'
    assert.equal((await c.get('state')).status, 409)
    assert.equal((await c.post('prepare', { type: 'tuition' })).body.code, 'AUDIT_INTEGRITY')
  }))

test('malformed identifiers cannot resolve prototype properties or authenticate an approval', async () => {
  const s = session()
  for (const id of ['constructor', 'toString', {}, null])
    assert.throws(() => validateDraft(s.state, id, NOW), errorCode('NOT_FOUND'))
  for (const id of ['constructor', 'toString', {}, null])
    assert.throws(
      () => executeDraft(s.state, { approvalId: id, token: 'bad' }, NOW),
      errorCode('APPROVAL_REQUIRED')
    )
  await setup(s)
  const d = prepare(s.state, { type: 'tuition' }, NOW),
    approval = await approveWithPin(
      s,
      { draftId: d.id, digest: d.digest, confirmed: true, pin: PIN },
      NOW
    )
  assert.throws(
    () => executeDraft(s.state, { ...approval, token: 'a'.repeat(64) }, NOW),
    errorCode('APPROVAL_REQUIRED')
  )
  assert.equal(s.state.invoice.paid, false)
})

test('HTTP malformed payment identifiers return bounded errors and leave balances unchanged', async () =>
  withApp(async c => {
    const invalid = await c.post('approve', {
      draftId: {},
      digest: 'invalid',
      confirmed: true,
      pin: PIN,
    })
    assert.equal(invalid.status, 404)
    assert.equal(invalid.body.code, 'NOT_FOUND')
    const execute = await c.post('execute', {
      approvalId: {},
      draftId: 'unknown',
      token: 'invalid',
    })
    assert.equal(execute.status, 403)
    assert.equal(execute.body.code, 'APPROVAL_REQUIRED')
    const state = await (await c.get('state')).json()
    assert.deepEqual(state.state.balances, c.boot.state.balances)
    assert.equal(state.state.auditIntegrity, true)
  }))

test('security status shows a fresh attempt allowance after cooldown without changing credentials', () => {
  const s = session()
  s.security = {
    pin: { salt: 'fixture-salt', hash: 'fixture-hash' },
    failures: 5,
    lockedUntil: NOW + 300000,
  }
  const before = structuredClone(s.security)
  assert.equal(securityStatus(s, NOW).attemptsRemaining, 0)
  assert.ok(securityStatus(s, NOW).lockedUntil)
  const recovered = securityStatus(s, NOW + 300001)
  assert.equal(recovered.lockedUntil, null)
  assert.equal(recovered.attemptsRemaining, 5)
  assert.equal(recovered.hasPin, true)
  assert.deepEqual(s.security, before)
})
