import { accountDefaults, accountStatus } from './accounts.mjs'
import { vaultKey, sealVault, openVault, isVault } from './vault.mjs'
import { guardianDefaults, checkInvoice } from './guardian.mjs'
import { randomUUID, createHash, randomBytes } from 'node:crypto'
import { readFile, mkdir, writeFile, rename } from 'node:fs/promises'
import { dirname } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

export class AppError extends Error {
  constructor(code, message, status = 400) {
    super(message)
    this.code = code
    this.status = status
  }
}

export const fail = (code, message, status = 400) => {
  throw new AppError(code, message, status)
}

export const round = n => Math.round((n + Number.EPSILON) * 100) / 100

export const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')

export const token = () => randomBytes(32).toString('hex')

export function studentDefaults(now = Date.now()) {
  return {
    profile: {
      name: 'Jamie Li',
      university: 'University of Amsterdam',
      homeCity: 'Shanghai',
      studyCity: 'Amsterdam',
      homeCurrency: 'CNY',
      semesterEnd: new Date(now + 120 * 86400000).toISOString().slice(0, 10),
      setupComplete: false,
    },
    incomes: [
      { id: 'demo-scholarship', label: 'Scholarship', amount: 900, currency: 'EUR', payDay: 28 },
    ],
    schedule: { rentDay: 1 },
  }
}

export function initialState(now = Date.now()) {
  const today = new Date(now).toISOString().slice(0, 10)
  const due = new Date(now)
  due.setUTCMonth(due.getUTCMonth() + 1, 1)
  const state = {
    ...studentDefaults(now),
    accounts: accountDefaults(),
    revision: 0,
    balances: { EUR: 2840, GBP: 1200, CNY: 18600 },
    tuitionPaid: false,
    budget: { rent: 720, groceries: 220, transport: 40, other: 150, buffer: 900 },
    market: { version: 1, rates: { EUR: 1, GBP: 1.17, CNY: 0.128 } },
    invoice: {
      id: randomUUID(),
      reference: 'UVA-2026-JL-1101',
      recipient: 'University of Amsterdam',
      account: 'DEMO-UVA-EUR-001',
      amount: 2300,
      currency: 'EUR',
      due: due.toISOString().slice(0, 10),
      verified: true,
      paid: false,
    },
    transactions: [
      {
        id: randomUUID(),
        date: today,
        description: 'Albert Heijn',
        category: 'Groceries',
        sample: true,
        amount: -29.8,
        currency: 'EUR',
      },
      {
        id: randomUUID(),
        date: today,
        description: 'Coffee with Mia',
        category: 'Food & drink',
        sample: true,
        amount: -4.2,
        currency: 'EUR',
      },
      {
        id: randomUUID(),
        date: today,
        description: 'Monthly scholarship',
        category: 'Income',
        sample: true,
        amount: 900,
        currency: 'EUR',
      },
    ],
    audit: [],
    drafts: {},
    approvals: {},
    chat: [],
  }
  state.guardian = guardianDefaults(state.invoice)
  state.familyRequests = {}
  appendAudit(
    state,
    'Sample planning data loaded',
    'Three sample balances loaded for exploration. Enter your own starting balances; no bank is connected.',
    {},
    now
  )
  return state
}

export function appendAudit(state, title, description, details = {}, now = Date.now()) {
  const previous = state.audit.at(-1)?.hash || 'GENESIS'
  const entry = {
    id: randomUUID(),
    timestamp: new Date(now).toISOString(),
    title,
    description,
    details,
    previousHash: previous,
  }
  entry.hash = digest(entry)
  state.audit.push(entry)
  return entry
}

export function verifyAudit(entries) {
  let previous = 'GENESIS'
  if (!Array.isArray(entries)) return false
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object' || typeof entry.hash !== 'string') return false
    const { hash, ...data } = entry
    if (data.previousHash !== previous || digest(data) !== hash) return false
    previous = hash
  }
  return true
}

export function publicState(state) {
  return {
    accounts: accountStatus(state),
    profile: state.profile,
    incomes: state.incomes,
    schedule: state.schedule,
    revision: state.revision,
    balances: state.balances,
    tuitionPaid: state.invoice.paid,
    budget: state.budget,
    invoice: state.invoice,
    guardian: checkInvoice(state),
    market: state.market,
    transactions: state.transactions,
    audit: [...state.audit].reverse(),
    auditIntegrity: verifyAudit(state.audit),
  }
}

export class Store {
  constructor(path, { replaceFile = rename, storageKey = process.env.FINMATE_STORAGE_KEY } = {}) {
    this.storageKey = storageKey
    this.replaceFile = replaceFile
    this.path = path
    this.sessions = {}
    this.queue = Promise.resolve()
  }
  async init() {
    let saved
    try {
      const raw = await readFile(this.path, 'utf8')
      try {
        saved = JSON.parse(raw)
      } catch {
        fail('VAULT_FORMAT', 'The saved vault is not valid JSON. No data was overwritten.', 500)
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
    if (saved !== undefined && (!saved || typeof saved !== 'object' || Array.isArray(saved)))
      fail('VAULT_FORMAT', 'Invalid session vault. Saved data was not overwritten.', 500)
    const encrypted = saved !== undefined && isVault(saved)
    this.key = await vaultKey(this.path, this.storageKey, encrypted)
    this.sessions = saved === undefined ? {} : encrypted ? openVault(saved, this.key) : saved
    let migrated = saved !== undefined && !encrypted
    for (const session of Object.values(this.sessions)) {
      if (
        !session?.state ||
        !Array.isArray(session.state.audit) ||
        !verifyAudit(session.state.audit)
      )
        fail(
          'AUDIT_INTEGRITY',
          'Saved audit evidence failed validation. No accounts were loaded or overwritten.',
          500
        )
      const defaults = studentDefaults()
      let changed = false
      for (const key of ['profile', 'incomes', 'schedule'])
        if (session.state[key] === undefined) {
          session.state[key] = defaults[key]
          changed = true
        }
      if (!session.state.guardian) {
        session.state.guardian = guardianDefaults(session.state.invoice)
        changed = true
      }
      session.state.familyRequests ??= {}
      if (!session.state.accounts) {
        session.state.accounts = accountDefaults()
        if (!Object.values(session.state.approvals || {}).some(a => a.used))
          for (const t of session.state.transactions) if (!t.imported) t.sample = true
        migrated = true
      }
      session.security ??= { pin: null, failures: 0, lockedUntil: 0 }
      session.createdAt ??= Date.now()
      if (changed) {
        session.state.revision++
        migrated = true
      }
    }
    if (migrated) await this.persist()
    return this
  }
  async persist(snapshot = this.sessions) {
    await mkdir(dirname(this.path), { recursive: true })
    const temporary = this.path + '.tmp'
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        await writeFile(temporary, sealVault(snapshot, this.key), { encoding: 'utf8', mode: 0o600 })
        await this.replaceFile(temporary, this.path)
        return
      } catch (error) {
        if (!['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || attempt === 4) throw error
        await delay(80 * 2 ** attempt)
      }
    }
  }
  async create() {
    const work = this.queue.then(async () => {
      if (Object.keys(this.sessions).length >= 100)
        fail('SESSION_LIMIT', 'The local sandbox session limit has been reached.', 429)
      const id = token(),
        session = {
          csrf: token(),
          security: { pin: null, failures: 0, lockedUntil: 0 },
          state: initialState(),
          createdAt: Date.now(),
        }
      await this.persist({ ...this.sessions, [id]: session })
      this.sessions[id] = session
      return { id, session }
    })
    this.queue = work.catch(() => {})
    return work
  }
  async mutate(id, fn) {
    const work = this.queue.then(async () => {
      const session = this.sessions[id]
      if (!session) fail('SESSION', 'Session expired. Reload the page.', 401)
      if (!verifyAudit(session.state.audit))
        fail('AUDIT_INTEGRITY', 'Audit integrity failed. Account operations are blocked.', 409)
      const next = structuredClone(session),
        result = await fn(next)
      if (!verifyAudit(next.state.audit))
        fail('AUDIT_INTEGRITY', 'Audit integrity failed. Account changes were not saved.', 409)
      await this.persist({ ...this.sessions, [id]: next })
      this.sessions[id] = next
      return result
    })
    this.queue = work.catch(() => {})
    return work
  }
}
