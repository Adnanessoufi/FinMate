import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { initialState, verifyAudit, Store } from '../backend/store.mjs'
import { verifyInvoice } from '../backend/invoice.mjs'
import { checkInvoice, reviewInvoiceChanges } from '../backend/guardian.mjs'
import {
  compareTuition,
  compareFunding,
  prepare,
  approveDraft,
  executeDraft,
} from '../backend/engine.mjs'
import { familyPreview, createFamilyRequest } from '../backend/family.mjs'
import { semesterPlan } from '../backend/semester.mjs'
import { saveStudent } from '../backend/student.mjs'
import { dispatchTool } from '../backend/agent.mjs'
import { createApp } from '../server.mjs'

const NOW = Date.parse('2026-10-11T10:00:00Z')
const seed = () => initialState(NOW)
const rejects = (fn, code) => assert.throws(fn, e => e.code === code)
const changed = (state, fields = { account: 'DEMO-CHANGED-002', reference: 'NEW-2026-02' }) =>
  verifyInvoice(state, { ...state.invoice, ...fields, confirmed: true }, NOW)
const review = (state, extra = {}) => {
  const g = checkInvoice(state)
  return reviewInvoiceChanges(
    state,
    {
      invoiceId: g.invoiceId,
      checkDigest: g.checkDigest,
      baseRevision: g.revision,
      confirmed: true,
      method: 'known-contact',
      note: 'Confirmed these changes with the existing university contact.',
      ...extra,
    },
    NOW
  )
}

test('guardian shows exact changed fields and never accepts document verification as change review', () => {
  const state = seed(),
    before = { ...state.balances }
  changed(state, {
    recipient: 'Different University',
    account: 'CHANGED-002',
    amount: 2500,
    currency: 'GBP',
    reference: 'NEW-02',
  })
  const check = checkInvoice(state)
  assert.deepEqual(
    check.flags.map(f => f.code),
    ['RECIPIENT_CHANGED', 'ACCOUNT_CHANGED', 'CURRENCY_CHANGED', 'AMOUNT_CHANGED']
  )
  assert.equal(check.baseline.account, 'DEMO-UVA-EUR-001')
  assert.equal(check.canPlan, false)
  rejects(() => compareTuition(state, {}, NOW), 'GUARDIAN_REVIEW')
  rejects(() => compareFunding(state, {}, NOW), 'GUARDIAN_REVIEW')
  rejects(() => prepare(state, { type: 'tuition' }, NOW), 'GUARDIAN_REVIEW')
  assert.deepEqual(state.balances, before)
})

test('formatting differences are normalized while new recipient accounts still require review', () => {
  const state = seed()
  changed(state, {
    account: ' demo uva eur 001 ',
    recipient: ' UNIVERSITY OF AMSTERDAM ',
    reference: 'NEW-02',
  })
  assert.equal(checkInvoice(state).status, 'clear')
  changed(state, { account: 'DEMO-UVA-EUR-003', reference: 'NEW-03' })
  assert.equal(checkInvoice(state).status, 'review-required')
})

test('reused unpaid references are flagged but re-verifying the same invoice is harmless', () => {
  const state = seed(),
    id = state.invoice.id
  changed(state, { ...state.invoice })
  assert.equal(state.invoice.id, id)
  assert.equal(checkInvoice(state).status, 'clear')
  changed(state, { amount: 2400, reference: state.invoice.reference })
  assert.ok(checkInvoice(state).flags.some(f => f.code === 'REFERENCE_REUSED'))
})

test('separate review requires confirmation, independent-check evidence and exact current comparison', () => {
  const state = seed()
  changed(state)
  rejects(() => review(state, { confirmed: false }), 'GUARDIAN_CONFIRM')
  rejects(() => review(state, { note: 'yes' }), 'GUARDIAN_EVIDENCE')
  rejects(() => review(state, { method: 'invoice-email' }), 'GUARDIAN_EVIDENCE')
  rejects(() => review(state, { checkDigest: 'forged' }), 'STATE_CHANGED')
  rejects(() => review(state, { baseRevision: state.revision - 1 }), 'STATE_CHANGED')
  const revision = state.revision,
    before = { ...state.balances }
  review(state)
  assert.equal(checkInvoice(state).status, 'reviewed')
  assert.equal(state.revision, revision + 1)
  assert.deepEqual(state.balances, before)
  assert.equal(Object.keys(state.approvals).length, 0)
  assert.ok(verifyAudit(state.audit))
  const draft = prepare(state, { type: 'tuition' }, NOW)
  rejects(() => executeDraft(state, { draftId: draft.id }, NOW), 'APPROVAL_REQUIRED')
})

test('review cannot be replayed after new changes, and trusted baseline advances only after review', () => {
  const state = seed()
  changed(state)
  const first = checkInvoice(state)
  changed(state, { account: 'DEMO-CHANGED-003', reference: 'NEW-03' })
  assert.equal(checkInvoice(state).baseline.account, 'DEMO-UVA-EUR-001')
  rejects(
    () => review(state, { checkDigest: first.checkDigest, invoiceId: first.invoiceId }),
    'STATE_CHANGED'
  )
  review(state)
  changed(state, { account: 'DEMO-CHANGED-004', reference: 'NEW-04' })
  assert.equal(checkInvoice(state).baseline.account, 'DEMO-CHANGED-003')
  assert.equal(checkInvoice(state).canPlan, false)
})

test('guardian blocks direct approval and execution if contents were altered outside normal invoice routes', () => {
  const state = seed(),
    draft = prepare(state, { type: 'tuition' }, NOW)
  state.invoice.account = 'ALTERED'
  rejects(
    () => approveDraft(state, { draftId: draft.id, digest: draft.digest, confirmed: true }, NOW),
    'GUARDIAN_REVIEW'
  )
  state.invoice.account = 'DEMO-UVA-EUR-001'
  const approval = approveDraft(
    state,
    { draftId: draft.id, digest: draft.digest, confirmed: true },
    NOW
  )
  state.invoice.account = 'ALTERED'
  rejects(() => executeDraft(state, approval, NOW), 'GUARDIAN_REVIEW')
  assert.equal(state.invoice.paid, false)
})

test('paid references cannot be reused by changing the recipient account or letter casing', () => {
  const state = seed(),
    draft = prepare(state, { type: 'tuition' }, NOW),
    approval = approveDraft(
      state,
      { draftId: draft.id, digest: draft.digest, confirmed: true },
      NOW
    )
  executeDraft(state, approval, NOW)
  rejects(
    () =>
      changed(state, { account: 'DIFFERENT', reference: state.invoice.reference.toUpperCase() }),
    'ALREADY_PAID'
  )
})

test('student setup cannot bypass guardian and semester priorities retain the blocked tuition obligation', () => {
  const state = seed()
  saveStudent(
    state,
    {
      baseRevision: state.revision,
      confirmed: true,
      profile: { ...state.profile, setupComplete: true },
      budget: state.budget,
      incomes: state.incomes,
      schedule: state.schedule,
      invoice: { ...state.invoice, account: 'CHANGED', reference: 'NEW-02' },
      invoiceConfirmed: true,
    },
    NOW
  )
  assert.equal(checkInvoice(state).canPlan, false)
  const plan = semesterPlan(state, {}, NOW)
  assert.equal(plan.next.id, 'guardian-review')
  assert.ok(plan.projection.events.some(e => /tuition/i.test(e.type)))
  assert.equal(plan.tuition, null)
})

test('first recipient requires independent review when no previous verified baseline exists', () => {
  const state = seed()
  state.invoice.verified = false
  state.guardian = { baseline: null, history: [], review: null }
  changed(state, { reference: 'FIRST' })
  assert.ok(checkInvoice(state).flags.some(f => f.code === 'FIRST_RECIPIENT'))
  assert.equal(checkInvoice(state).canPlan, false)
  review(state)
  assert.equal(checkInvoice(state).canPlan, true)
})

test('family shortfall uses selected accounts only, protects euros and includes cent-safe family fees', () => {
  const state = seed(),
    before = { ...state.balances }
  for (const currency of ['EUR', 'GBP', 'CNY']) {
    const preview = familyPreview(
      state,
      { sourceCurrency: 'EUR', backupCurrencies: [], currency },
      NOW
    )
    assert.equal(preview.shortfall, 1490)
    assert.equal(preview.studentContribution, 810)
    assert.ok(preview.quote.received >= 1490)
    assert.ok(preview.quote.arrival <= state.invoice.due)
    assert.equal(
      preview.quote.received,
      Math.round((preview.quote.amount - preview.quote.fee) * state.market.rates[currency] * 100) /
        100
    )
    assert.equal(preview.share.studentName, false)
  }
  assert.deepEqual(state.balances, before)
  assert.equal(Object.keys(state.approvals).length, 0)
  const funded = familyPreview(
    state,
    { sourceCurrency: 'CNY', backupCurrencies: ['GBP'], currency: 'CNY' },
    NOW
  )
  assert.equal(funded.funded, true)
  rejects(
    () =>
      createFamilyRequest(
        state,
        {
          sourceCurrency: 'CNY',
          backupCurrencies: ['GBP'],
          currency: 'CNY',
          previewDigest: funded.previewDigest,
          confirmed: true,
        },
        NOW
      ),
    'FAMILY_FUNDED'
  )
})

test('family privacy selections exclude accounts, references, names and financial details by default', () => {
  const state = seed(),
    input = { sourceCurrency: 'EUR', backupCurrencies: [], currency: 'CNY' },
    preview = familyPreview(state, input, NOW)
  for (const secret of [
    state.invoice.account,
    state.invoice.reference,
    state.profile.name,
    state.invoice.recipient,
    'Scholarship',
    '18600',
    '2840',
  ])
    assert.equal(preview.text.includes(secret), false, secret)
  const selected = familyPreview(
    state,
    {
      ...input,
      share: { studentName: true, university: true, tuitionTotal: true, studentContribution: true },
    },
    NOW
  )
  assert.ok(selected.text.includes(state.profile.name))
  assert.ok(selected.text.includes(state.invoice.recipient))
  assert.ok(selected.text.includes('2300.00 EUR'))
  assert.ok(selected.text.includes('810.00 EUR'))
  assert.equal(selected.text.includes(state.invoice.account), false)
  rejects(
    () => familyPreview(state, { ...input, share: { accounts: true } }, NOW),
    'FAMILY_PRIVACY'
  )
  rejects(
    () => familyPreview(state, { ...input, share: { university: 'true' } }, NOW),
    'FAMILY_PRIVACY'
  )
})

test('creating a family request requires exact preview and consent; rates, balances, day or sharing changes invalidate it', () => {
  const state = seed(),
    input = { sourceCurrency: 'EUR', backupCurrencies: [], currency: 'CNY' },
    preview = familyPreview(state, input, NOW),
    before = { ...state.balances }
  rejects(
    () =>
      createFamilyRequest(
        state,
        { ...input, previewDigest: preview.previewDigest, confirmed: false },
        NOW
      ),
    'FAMILY_CONFIRM'
  )
  rejects(
    () =>
      createFamilyRequest(
        state,
        {
          ...input,
          share: { university: true },
          previewDigest: preview.previewDigest,
          confirmed: true,
        },
        NOW
      ),
    'STATE_CHANGED'
  )
  rejects(
    () =>
      createFamilyRequest(
        state,
        { ...input, previewDigest: preview.previewDigest, confirmed: true },
        NOW + 86400000
      ),
    'STATE_CHANGED'
  )
  state.market.version++
  rejects(
    () =>
      createFamilyRequest(
        state,
        { ...input, previewDigest: preview.previewDigest, confirmed: true },
        NOW
      ),
    'STATE_CHANGED'
  )
  state.market.version--
  state.balances.EUR += 1
  rejects(
    () =>
      createFamilyRequest(
        state,
        { ...input, previewDigest: preview.previewDigest, confirmed: true },
        NOW
      ),
    'STATE_CHANGED'
  )
  state.balances.EUR -= 1
  const request = createFamilyRequest(
    state,
    { ...input, previewDigest: preview.previewDigest, confirmed: true },
    NOW
  )
  assert.equal(request.text, preview.text)
  assert.deepEqual(state.balances, before)
  assert.ok(verifyAudit(state.audit))
  assert.equal(Object.keys(state.approvals).length, 0)
})

test('unverified, guardian-paused, overdue or unsupported requests are rejected', () => {
  const state = seed()
  rejects(() => familyPreview(state, { currency: 'USD' }, NOW), 'CURRENCY')
  state.invoice.verified = false
  rejects(() => familyPreview(state, {}, NOW), 'INVOICE_UNVERIFIED')
  state.invoice.verified = true
  changed(state)
  rejects(() => familyPreview(state, {}, NOW), 'GUARDIAN_REVIEW')
  review(state)
  const overdue = seed()
  overdue.invoice.due = '2026-10-10'
  rejects(() => familyPreview(overdue, {}, NOW), 'FAMILY_DEADLINE')
})

test('agent has no tool for clearing guardian or creating or sending family requests', async () => {
  const fake = {}
  for (const tool of ['review_invoice_changes', 'create_family_request', 'send_family_request'])
    await assert.rejects(dispatchTool(fake, 'session', tool, {}), e => e.code === 'TOOL_FORBIDDEN')
})

test('HTTP guardian and family workflows enforce CSRF, preserve session privacy and persist evidence', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'finmate-guardian-'))
  assert.equal(dirname(directory), tmpdir())
  let server
  try {
    const app = await createApp({ path: join(directory, 'sessions.json') })
    server = app.server
    await new Promise(r => server.listen(0, '127.0.0.1', r))
    const base = `http://127.0.0.1:${server.address().port}`
    const r = await fetch(base + '/api/bootstrap'),
      cookie = r.headers.get('set-cookie').split(';')[0],
      boot = await r.json()
    const post = (path, input) =>
      fetch(base + '/api/' + path, {
        method: 'POST',
        headers: {
          Cookie: cookie,
          Origin: base,
          'Content-Type': 'application/json',
          'X-FinMate-CSRF': boot.csrf,
        },
        body: JSON.stringify(input),
      })
    assert.equal(
      (
        await fetch(base + '/api/invoice/review-changes', {
          method: 'POST',
          headers: { Cookie: cookie, 'Content-Type': 'application/json' },
          body: '{}',
        })
      ).status,
      403
    )
    const invoice = {
      ...boot.state.invoice,
      account: 'CHANGED-HTTP',
      reference: 'NEW-HTTP',
      confirmed: true,
    }
    const saved = await (await post('invoice/verify', invoice)).json()
    assert.equal(saved.state.guardian.canPlan, false)
    assert.equal((await post('prepare', { type: 'tuition' })).status, 409)
    assert.equal((await post('semester', {})).status, 200)
    const g = saved.state.guardian
    assert.equal(
      (
        await post('invoice/review-changes', {
          invoiceId: g.invoiceId,
          checkDigest: g.checkDigest,
          baseRevision: g.revision,
          confirmed: true,
          method: 'university-portal',
          note: 'Confirmed recipient details through existing student portal.',
        })
      ).status,
      200
    )
    const input = {
        sourceCurrency: 'EUR',
        backupCurrencies: [],
        currency: 'CNY',
        share: { university: true },
      },
      preview = (await (await post('family/preview', input)).json()).preview
    const result = await (
      await post('family/request', {
        ...input,
        previewDigest: preview.previewDigest,
        confirmed: true,
      })
    ).json()
    assert.ok(result.request.id)
    assert.deepEqual(result.state.balances, boot.state.balances)
    const download = await fetch(base + '/api/family/request/' + result.request.id, {
      headers: { Cookie: cookie },
    })
    assert.equal(download.status, 200)
    assert.equal(await download.text(), preview.text)
    assert.match(download.headers.get('content-disposition'), /attachment/)
    const stranger = await fetch(base + '/api/bootstrap'),
      other = stranger.headers.get('set-cookie').split(';')[0]
    assert.equal(
      (
        await fetch(base + '/api/family/request/' + result.request.id, {
          headers: { Cookie: other },
        })
      ).status,
      404
    )
    assert.equal(
      (await fetch(base + '/api/family/request/constructor', { headers: { Cookie: cookie } }))
        .status,
      404
    )
    const restored = await new Store(join(directory, 'sessions.json')).init(),
      state = Object.values(restored.sessions).find(s => s.csrf === boot.csrf).state
    assert.ok(state.familyRequests[result.request.id])
    assert.equal(checkInvoice(state).status, 'reviewed')
    assert.ok(verifyAudit(state.audit))
  } finally {
    if (server) await new Promise(r => server.close(r))
    assert.equal(dirname(directory), tmpdir())
    await rm(directory, { recursive: true, force: true })
  }
})
import { runAgent } from '../backend/agent.mjs'

test('offline family estimate uses the actual tool and never creates or sends a request', async () => {
  const state = seed(),
    store = { sessions: { synthetic: { state } }, mutate: async (id, fn) => fn({ state }) }
  const result = await runAgent(
    store,
    'synthetic',
    'How much should I ask my family for tuition using only my EUR account?',
    { config: { mode: 'offline', model: null } }
  )
  assert.equal(result.family.shortfall, 1490)
  assert.equal(result.family.sourceCurrency, 'EUR')
  assert.deepEqual(result.family.backupCurrencies, [])
  assert.equal(result.draft, null)
  assert.equal(Object.keys(state.familyRequests).length, 0)
  assert.ok(result.trace.some(t => t.tool === 'preview_family_request'))
})

test('rechecking an unchanged invoice preserves the separate review and its exact evidence', () => {
  const state = seed()
  changed(state)
  review(state)
  const before = structuredClone(state.guardian.review)
  changed(state, { ...state.invoice })
  assert.equal(checkInvoice(state).status, 'reviewed')
  assert.deepEqual(state.guardian.review, before)
})
