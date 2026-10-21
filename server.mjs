import { tuitionMission, prepareMission } from './backend/mission.mjs'
import { referenceRates } from './backend/reference-rates.mjs'
import { setStartingBalances, recordDeposit } from './backend/accounts.mjs'
import {
  safeEqual,
  securityStatus,
  setPaymentPin,
  approveWithPin,
  RateLimiter,
  validateJsonObject,
} from './backend/security.mjs'
import { checkInvoice, reviewInvoiceChanges } from './backend/guardian.mjs'
import { familyPreview, createFamilyRequest } from './backend/family.mjs'
import http from 'node:http'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  Store,
  AppError,
  fail,
  initialState,
  publicState,
  appendAudit,
  verifyAudit,
} from './backend/store.mjs'
import {
  compareTuition,
  compareFunding,
  compareTransfers,
  prepare,
  executeDraft,
  isoDay,
} from './backend/engine.mjs'
import { forecast } from './backend/forecast.mjs'
import { affordability } from './backend/affordability.mjs'
import { saveStudent } from './backend/student.mjs'
import { semesterPlan } from './backend/semester.mjs'
import { extractInvoice, verifyInvoice, pdfText } from './backend/invoice.mjs'
import { runAgent, agentConfig } from './backend/agent.mjs'
import { parseCSV } from './finance.js'

const root = resolve(import.meta.dirname)

try {
  process.loadEnvFile(resolve(root, '.env'))
} catch (error) {
  if (error.code !== 'ENOENT') throw error
}

const assets = new Map([
  ['/', 'index.html'],
  ['/index.html', 'index.html'],
  ['/app.js', 'app.js'],
  ['/finance.js', 'finance.js'],
  ['/styles.css', 'styles.css'],
  ['/favicon.svg', 'favicon.svg'],
  ['/sample-statement.csv', 'sample-statement.csv'],
  ['/samples/changed-account-invoice.txt', 'samples/changed-account-invoice.txt'],
  ['/samples/tuition-invoice.txt', 'samples/tuition-invoice.txt'],
  ['/samples/tuition-invoice.pdf', 'samples/tuition-invoice.pdf'],
])
const types = {
  html: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  svg: 'image/svg+xml',
  csv: 'text/csv; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  pdf: 'application/pdf',
}

function json(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  })
  res.end(JSON.stringify(data))
}

const routeKeys = new Map(
  Object.entries({
    'accounts/starting-balances': ['balances', 'baseRevision', 'confirmed', 'clearSampleHistory'],
    'accounts/deposit': ['currency', 'amount', 'label', 'requestId', 'baseRevision', 'confirmed'],
    'mission/plan': ['sourceCurrency', 'backupCurrencies', 'incomeDelay'],
    'mission/prepare': [
      'sourceCurrency',
      'backupCurrencies',
      'incomeDelay',
      'planDigest',
      'baseRevision',
      'marketVersion',
      'confirmed',
    ],
    agent: ['message', 'language'],
    'security/pin': ['newPin', 'repeatPin', 'currentPin', 'confirmed'],
    'invoice/guardian': [],
    'invoice/review-changes': [
      'invoiceId',
      'checkDigest',
      'baseRevision',
      'confirmed',
      'method',
      'note',
    ],
    'family/preview': ['sourceCurrency', 'backupCurrencies', 'currency', 'share'],
    'family/request': [
      'sourceCurrency',
      'backupCurrencies',
      'currency',
      'share',
      'previewDigest',
      'confirmed',
    ],
    'tuition/funding': ['sourceCurrency', 'backupCurrencies', 'buffer'],
    'tuition/compare': ['sourceCurrency', 'buffer'],
    'transfers/compare': ['amount', 'from', 'to'],
    prepare: [
      'type',
      'sourceCurrency',
      'backupCurrencies',
      'buffer',
      'route',
      'amount',
      'from',
      'to',
    ],
    approve: ['draftId', 'digest', 'confirmed', 'pin'],
    execute: ['draftId', 'approvalId', 'token'],
    student: [
      'profile',
      'budget',
      'schedule',
      'incomes',
      'baseRevision',
      'confirmed',
      'invoice',
      'invoiceConfirmed',
    ],
    semester: [],
    scenario: ['fxDrop', 'incomeDelay', 'rentIncrease', 'days'],
    affordability: ['amount', 'currency', 'date', 'label', 'fxDrop', 'incomeDelay', 'rentIncrease'],
    budget: ['rent', 'groceries', 'transport', 'other', 'buffer', 'confirmed'],
    'invoice/extract': ['text', 'pdf'],
    'invoice/verify': [
      'id',
      'recipient',
      'account',
      'reference',
      'amount',
      'currency',
      'due',
      'confirmed',
      'verified',
      'paid',
    ],
    import: ['text'],
    'demo/reset': [],
    'demo/expire': ['draftId'],
    'demo/rates': [],
    'demo/funding-gap': [],
    'demo/deadline': [],
  })
)

async function body(req) {
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type'] || ''))
    fail('CONTENT_TYPE', 'Send UTF-8 JSON.', 415)
  if (Number(req.headers['content-length']) > 1600000)
    fail('BODY_LIMIT', 'The upload is too large.', 413)
  if (req.body !== undefined) {
    let input
    try {
      input = typeof req.body === 'string' ? JSON.parse(req.body) : req.body
    } catch {
      fail('JSON', 'Invalid UTF-8 JSON.')
    }
    if (Buffer.byteLength(JSON.stringify(input)) > 1600000)
      fail('BODY_LIMIT', 'The upload is too large.', 413)
    return validateJsonObject(input)
  }
  const chunks = []
  let length = 0
  for await (const chunk of req) {
    length += chunk.length
    if (length > 1600000) fail('BODY_LIMIT', 'The upload is too large.', 413)
    chunks.push(chunk)
  }
  let input
  try {
    input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)))
  } catch {
    fail('JSON', 'Invalid UTF-8 JSON.')
  }
  return validateJsonObject(input)
}

export async function createApp({
  path = resolve(root, 'data/sessions.json'),
  storageKey = process.env.FINMATE_STORAGE_KEY,
  rateLimits = {},
  store: suppliedStore,
  publicOrigins = [],
  hosted = false,
} = {}) {
  const store = suppliedStore || (await new Store(path, { storageKey }).init())
  if (hosted && !publicOrigins.length)
    fail('HOST_CONFIG', 'A public HTTPS origin is required for hosted requests.', 500)
  for (const origin of publicOrigins) {
    const parsed = new URL(origin)
    if (parsed.protocol !== 'https:' || parsed.origin !== origin)
      fail('HOST_CONFIG', 'Public origins must be exact HTTPS origins.', 500)
  }
  const dailyAgentLimit = Number(process.env.FINMATE_DAILY_AGENT_LIMIT || 100)
  if (
    hosted &&
    (!Number.isSafeInteger(dailyAgentLimit) || dailyAgentLimit < 1 || dailyAgentLimit > 10000)
  )
    fail('HOST_CONFIG', 'The daily agent limit must be between 1 and 10000.', 500)
  const agentBusy = new Set()
  const limits = {
    api: new RateLimiter({ limit: rateLimits.api ?? 300 }),
    agent: new RateLimiter({ limit: rateLimits.agent ?? 12 }),
    pin: new RateLimiter({ limit: rateLimits.pin ?? 15 }),
    bootstrap: new RateLimiter({ limit: rateLimits.bootstrap ?? 30 }),
  }
  const consume = async (scope, identity) => {
    if (hosted) return store.consumeLimit(scope, identity, rateLimits[scope] ?? limits[scope].limit)
    limits[scope].consume(identity)
  }
  const handler = async (req, res) => {
    res.setHeader('X-Frame-Options', 'DENY')
    res.setHeader('Referrer-Policy', 'no-referrer')
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()')
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    const address = server.address()
    const allowedHosts = hosted
      ? publicOrigins.map(origin => new URL(origin).host)
      : [`127.0.0.1:${address.port}`, `localhost:${address.port}`]
    const requestOrigin = `${hosted ? 'https' : 'http'}://${req.headers.host}`
    const clientAddress = hosted
      ? req.headers['x-vercel-forwarded-for'] ||
        req.headers['x-forwarded-for'] ||
        req.socket.remoteAddress
      : req.socket.remoteAddress
    if (!allowedHosts.includes(req.headers.host)) {
      json(res, 403, { error: 'Unexpected request host.', code: 'HOST' })
      return
    }
    let sessionId
    try {
      const url = new URL(req.url, requestOrigin)
      if (url.pathname.startsWith('/api/')) {
        if (req.headers['sec-fetch-site'] === 'cross-site')
          fail('CROSS_SITE', 'Cross-site financial requests are blocked.', 403)
        await consume('api', clientAddress)
      }

      if (!url.pathname.startsWith('/api/')) {
        const asset = assets.get(url.pathname)
        if (!asset || req.method !== 'GET') fail('NOT_FOUND', 'Not found.', 404)
        const data = await readFile(resolve(root, asset))
        res.writeHead(200, {
          'Content-Type': types[asset.split('.').at(-1)],
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
          'Referrer-Policy': 'same-origin',
          'Content-Security-Policy':
            "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; style-src-attr 'unsafe-inline'; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
        })
        res.end(data)
        return
      }
      sessionId = req.headers.cookie?.match(/(?:^|;\s*)finmate_session=([a-f0-9]{64})(?:;|$)/)?.[1]
      if (url.pathname === '/api/bootstrap' && req.method === 'GET') {
        await consume('bootstrap', clientAddress)
        let session = await store.get(sessionId)
        if (!session) {
          const created = await store.create()
          sessionId = created.id
          session = created.session
          res.setHeader(
            'Set-Cookie',
            `finmate_session=${sessionId}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000${hosted ? '; Secure' : ''}`
          )
        }
        if (!verifyAudit(session.state.audit))
          fail('AUDIT_INTEGRITY', 'Audit integrity failed. Accounts are unavailable.', 409)
        json(res, 200, {
          csrf: session.csrf,
          security: securityStatus(session),
          state: publicState(session.state),
          agent: agentConfig(),
        })
        return
      }
      const session = await store.get(sessionId)
      if (!session) fail('SESSION', 'Reload to create your demo session.', 401)
      if (!verifyAudit(session.state.audit))
        fail('AUDIT_INTEGRITY', 'Audit integrity failed. Account operations are blocked.', 409)
      if (req.method === 'GET') {
        if (url.pathname.startsWith('/api/family/request/')) {
          const id = url.pathname.slice('/api/family/request/'.length)
          const request =
            /^[a-f0-9-]{36}$/.test(id) && Object.hasOwn(session.state.familyRequests || {}, id)
              ? session.state.familyRequests[id]
              : null
          if (!request) fail('NOT_FOUND', 'Request not found in this session.', 404)
          res.writeHead(200, {
            'Content-Type': 'text/plain; charset=utf-8',
            'Content-Disposition': 'attachment; filename="finmate-family-request.txt"',
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
          })
          res.end(request.text)
          return
        }
        if (url.pathname === '/api/reference-rates') {
          json(res, 200, { reference: await referenceRates.get() })
          return
        }
        if (url.pathname === '/api/security/status') {
          json(res, 200, { security: securityStatus(session) })
          return
        }
        if (url.pathname === '/api/state') {
          json(res, 200, {
            csrf: session.csrf,
            security: securityStatus(session),
            state: publicState(session.state),
            agent: agentConfig(),
          })
          return
        }
        if (url.pathname === '/api/export') {
          res.setHeader(
            'Content-Disposition',
            'attachment; filename="finmate-execution-evidence.json"'
          )
          json(res, 200, {
            exportedAt: new Date().toISOString(),
            simulation: true,
            auditIntegrity: verifyAudit(session.state.audit),
            audit: session.state.audit,
            depositReceipts: Object.values(session.state.accounts?.deposits || {}).map(
              d => d.receipt
            ),
            receipts: Object.values(session.state.approvals)
              .filter(a => a.used)
              .map(a => a.receipt),
            invoice: session.state.invoice,
          })
          return
        }
        fail('NOT_FOUND', 'API route not found.', 404)
      }
      if (req.method !== 'POST') fail('METHOD', 'Use GET or POST.', 405)
      if (
        req.headers.origin !== requestOrigin ||
        !safeEqual(req.headers['x-finmate-csrf'], session.csrf)
      )
        fail('CSRF', 'This request is missing a matching session and origin.', 403)
      const input = await body(req),
        allowed = routeKeys.get(url.pathname.slice(5))
      if (allowed && Object.keys(input).some(k => !allowed.includes(k)))
        fail('INPUT_KEYS', 'Unexpected request fields.')
      if (['/api/approve', '/api/security/pin'].includes(url.pathname))
        await consume('pin', sessionId)

      if (url.pathname === '/api/agent') {
        await consume('agent', clientAddress)
        if (hosted) await store.consumeLimit('agent-day', 'site', dailyAgentLimit, 86400)
        if (agentBusy.size >= 2) fail('AGENT_BUSY', 'The local agent is busy. Retry shortly.', 429)
        if (agentBusy.has(sessionId))
          fail('AGENT_BUSY', 'Wait for the current agent task to finish.', 429)
        agentBusy.add(sessionId)
        try {
          const result = await runAgent(store, sessionId, input.message, {
            language: input.language,
          })
          json(res, 200, { ...result, state: publicState((await store.get(sessionId)).state) })
        } finally {
          agentBusy.delete(sessionId)
        }
        return
      }
      const result = await store.mutate(sessionId, async current => {
        const state = current.state
        try {
          switch (url.pathname) {
            case '/api/mission/plan':
              return { plan: tuitionMission(state, input) }
            case '/api/mission/prepare':
              return { draft: prepareMission(state, input) }
            case '/api/invoice/guardian':
              return { guardian: checkInvoice(state) }
            case '/api/invoice/review-changes':
              return { guardian: reviewInvoiceChanges(state, input), state: publicState(state) }
            case '/api/family/preview':
              return { preview: familyPreview(state, input) }
            case '/api/family/request':
              return { request: createFamilyRequest(state, input), state: publicState(state) }
            case '/api/tuition/funding':
              return { plans: compareFunding(state, input) }
            case '/api/tuition/compare':
              return { routes: compareTuition(state, input) }
            case '/api/transfers/compare':
              return { routes: compareTransfers(state, input) }
            case '/api/prepare':
              return { draft: prepare(state, input) }
            case '/api/accounts/starting-balances':
              return { accounts: setStartingBalances(state, input), state: publicState(state) }
            case '/api/accounts/deposit':
              return { receipt: recordDeposit(state, input), state: publicState(state) }
            case '/api/security/pin':
              return {
                security: await setPaymentPin(current, input),
                csrf: current.csrf,
                state: publicState(state),
              }
            case '/api/approve':
              return { approval: await approveWithPin(current, input) }
            case '/api/execute':
              return { receipt: executeDraft(state, input), state: publicState(state) }
            case '/api/student':
              saveStudent(state, input)
              return { state: publicState(state) }
            case '/api/semester':
              return { plan: semesterPlan(state, input) }
            case '/api/scenario':
              return { scenario: forecast(state, input) }
            case '/api/affordability': {
              const assessment = affordability(state, input)
              appendAudit(
                state,
                'Affordability checked',
                `${assessment.input.label}: ${assessment.status}. No funds reserved or moved.`,
                {
                  input: assessment.input,
                  status: assessment.status,
                  maxAmount: assessment.maxAmount,
                }
              )
              return { assessment, state: publicState(state) }
            }
            case '/api/budget': {
              const keys = ['rent', 'groceries', 'transport', 'other', 'buffer']
              if (
                keys.some(k => !Number.isFinite(input[k]) || input[k] < 0 || input[k] > 100000) ||
                input.confirmed !== true
              )
                fail('BUDGET', 'Check all budget values and confirm your update.')
              state.budget = Object.fromEntries(keys.map(k => [k, input[k]]))
              state.revision++
              appendAudit(
                state,
                'Living budget updated',
                'The user updated monthly essentials and the emergency reserve.',
                state.budget
              )
              return { state: publicState(state) }
            }
            case '/api/invoice/extract': {
              let text = input.text
              if (input.pdf) {
                if (typeof input.pdf !== 'string' || input.pdf.length > 1400000)
                  fail('PDF_LIMIT', 'Use a PDF smaller than 1 MB.')
                const bytes = Buffer.from(input.pdf, 'base64')
                if (bytes.subarray(0, 5).toString() !== '%PDF-')
                  fail('PDF_INVALID', 'This file is not a valid PDF.')
                text = await pdfText(bytes)
              }
              const extracted = extractInvoice(text)
              extracted.guardian = checkInvoice(state, {
                ...extracted.fields,
                id: 'extraction-preview',
              })
              appendAudit(
                state,
                'Invoice fields extracted',
                'Local extraction only; the document has no permission to change accounts.',
                { method: extracted.method, warnings: extracted.warnings }
              )
              return { extracted }
            }
            case '/api/invoice/verify':
              return { invoice: verifyInvoice(state, input), state: publicState(state) }
            case '/api/import': {
              let rows
              try {
                rows = parseCSV(input.text)
              } catch (error) {
                fail('CSV', error.message)
              }
              if (rows.length > 1000) fail('CSV_LIMIT', 'Import at most 1,000 transactions.')
              const seen = new Set(
                state.transactions.map(t =>
                  JSON.stringify([t.date, t.description, t.amount, t.currency])
                )
              )
              const fresh = rows
                .filter(t => {
                  const key = JSON.stringify([t.date, t.description, t.amount, t.currency])
                  if (seen.has(key)) return false
                  seen.add(key)
                  return true
                })
                .map(t => ({ ...t, imported: true }))
              if (!fresh.length)
                fail('CSV_DUPLICATES', 'These transactions are already in your journal.')
              state.transactions = [...fresh, ...state.transactions].sort((a, b) =>
                b.date.localeCompare(a.date)
              )
              state.revision++
              appendAudit(
                state,
                'Statement imported',
                `${fresh.length} transactions added locally. Balances unchanged.`,
                { count: fresh.length }
              )
              return { count: fresh.length, state: publicState(state) }
            }
            case '/api/demo/reset':
              current.state = initialState()
              return { state: publicState(current.state) }
            case '/api/demo/expire': {
              const draft = state.drafts[input.draftId]
              if (!draft) fail('NOT_FOUND', 'Prepare a quote first.', 404)
              draft.expiresAt = new Date(Date.now() - 1000).toISOString()
              appendAudit(
                state,
                'Demo quote expired',
                'Failure demonstration: old approvals cannot execute an expired quote.',
                { draftId: input.draftId }
              )
              return { expired: true }
            }
            case '/api/demo/rates':
              state.market.rates.CNY = Math.round(state.market.rates.CNY * 0.98 * 1000000) / 1000000
              state.market.version++
              appendAudit(
                state,
                'Demo rate changed',
                'CNY value reduced by 2%; existing quotes require fresh review.',
                { version: state.market.version }
              )
              return { state: publicState(state) }
            case '/api/demo/funding-gap':
              if (state.invoice.paid)
                fail(
                  'ALREADY_PAID',
                  'Reset the demo before creating a funding gap for a paid invoice.',
                  409
                )
              state.market.rates.CNY = Math.round(state.market.rates.CNY * 0.95 * 1000000) / 1000000
              state.market.version++
              appendAudit(
                state,
                'Demo funding gap created',
                'CNY weakened by 5%. Combine selected backup currencies to cover the tuition shortfall.',
                { version: state.market.version }
              )
              return { state: publicState(state) }
            case '/api/demo/deadline': {
              if (state.invoice.paid)
                fail('ALREADY_PAID', 'Reset the demo before changing a paid invoice.', 409)
              const due = new Date()
              due.setUTCDate(due.getUTCDate() + 1)
              state.invoice.due = isoDay(due)
              state.revision++
              appendAudit(
                state,
                'Demo deadline moved',
                'Tuition deadline set to tomorrow to demonstrate route filtering.',
                { due: state.invoice.due }
              )
              return { state: publicState(state) }
            }
            default:
              fail('NOT_FOUND', 'API route not found.', 404)
          }
        } catch (error) {
          if (!(error instanceof AppError)) throw error
          appendAudit(state, 'Action blocked', error.message, {
            code: error.code,
            path: url.pathname,
          })
          return { blocked: true, status: error.status, error: error.message, code: error.code }
        }
      })
      json(res, result.blocked ? result.status : 200, result)
    } catch (error) {
      if (error.code === 'RATE_LIMIT') {
        res.setHeader('Retry-After', String(error.retryAfter))
        json(res, 429, { error: error.message, code: error.code })
        return
      }
      if (!(error instanceof AppError))
        console.error(
          JSON.stringify({
            event: 'request_failed',
            path: req.url.split('?')[0],
            type: error.name,
            code: error.code || 'SERVER',
            frames: error.stack?.split('\n').slice(1, 3),
          })
        )
      json(res, error instanceof AppError ? error.status : 500, {
        error:
          error instanceof AppError
            ? error.message
            : 'The server could not complete the request. No payment was authorized.',
        code: error.code || 'SERVER',
      })
    }
  }
  const server = http.createServer(handler)
  return { server, store, handler }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { server } = await createApp()
  const port = Number(process.env.PORT || 5187)
  server.listen(port, '127.0.0.1', () =>
    console.log(`FinMate is ready at http://127.0.0.1:${port} · ${agentConfig().mode} agent`)
  )
}
