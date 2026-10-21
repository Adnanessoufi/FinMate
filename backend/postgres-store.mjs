import { createHash } from 'node:crypto'
import { initialState, token, verifyAudit, fail } from './store.mjs'
import { sealVault, openVault } from './vault.mjs'

export class PostgresStore {
  constructor(database, storageKey) {
    if (!/^[a-f0-9]{64}$/i.test(storageKey || ''))
      fail('VAULT_KEY', 'Hosted storage needs a separate 32-byte storage key.', 500)
    this.database = database
    this.key = Buffer.from(storageKey, 'hex')
  }

  async init() {
    await this.database.query(`CREATE TABLE IF NOT EXISTS finmate_sessions (
      id text PRIMARY KEY,
      vault text NOT NULL,
      version bigint NOT NULL DEFAULT 0,
      expires_at timestamptz NOT NULL DEFAULT (CURRENT_TIMESTAMP + INTERVAL '30 days')
    )`)
    await this.database.query(`CREATE TABLE IF NOT EXISTS finmate_request_limits (
      id text PRIMARY KEY,
      hits integer NOT NULL,
      resets_at timestamptz NOT NULL
    )`)
    return this
  }

  async read(id) {
    if (typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id)) return null
    const { rows } = await this.database.query(
      'SELECT vault, version FROM finmate_sessions WHERE id = $1 AND expires_at > CURRENT_TIMESTAMP',
      [id]
    )
    if (!rows.length) return null
    const saved = openVault(JSON.parse(rows[0].vault), this.key)
    const session = saved[id]
    if (!session?.state || !verifyAudit(session.state.audit))
      fail(
        'AUDIT_INTEGRITY',
        'Saved account integrity failed. Account operations are blocked.',
        409
      )
    return { session, version: rows[0].version }
  }

  async get(id) {
    return (await this.read(id))?.session
  }

  async create() {
    await this.database.query('DELETE FROM finmate_sessions WHERE expires_at <= CURRENT_TIMESTAMP')
    await this.database.query(
      'DELETE FROM finmate_request_limits WHERE resets_at <= CURRENT_TIMESTAMP'
    )
    const id = token()
    const session = {
      csrf: token(),
      security: { pin: null, failures: 0, lockedUntil: 0 },
      state: initialState(),
      createdAt: Date.now(),
    }
    const result = await this.database.query(
      `INSERT INTO finmate_sessions (id, vault)
       SELECT $1, $2 WHERE (SELECT COUNT(*) FROM finmate_sessions) < 1000 RETURNING id`,
      [id, sealVault({ [id]: session }, this.key)]
    )
    if (!result.rows.length)
      fail('SESSION_LIMIT', 'The sandbox session limit has been reached.', 429)
    return { id, session }
  }

  async mutate(id, fn) {
    for (let attempt = 0; attempt < 8; attempt++) {
      const saved = await this.read(id)
      if (!saved) fail('SESSION', 'Session expired. Reload the page.', 401)
      const result = await fn(saved.session)
      if (!verifyAudit(saved.session.state.audit))
        fail('AUDIT_INTEGRITY', 'Account integrity failed. Changes were not saved.', 409)
      // The version check keeps separate function instances from overwriting each other.
      const committed = await this.database.query(
        `UPDATE finmate_sessions SET vault = $1, version = version + 1
         WHERE id = $2 AND version = $3 AND expires_at > CURRENT_TIMESTAMP RETURNING id`,
        [sealVault({ [id]: saved.session }, this.key), id, saved.version]
      )
      if (committed.rows.length) return result
    }
    fail('STATE_CHANGED', 'Your account changed during this request. Reload and try again.', 409)
  }

  async consumeLimit(scope, identity, limit, windowSeconds = 60) {
    const id = createHash('sha256').update(`${scope}:${identity}`).digest('hex')
    const { rows } = await this.database.query(
      `INSERT INTO finmate_request_limits (id, hits, resets_at)
       VALUES ($1, 1, CURRENT_TIMESTAMP + ($2::integer * INTERVAL '1 second'))
       ON CONFLICT (id) DO UPDATE SET
         hits = CASE WHEN finmate_request_limits.resets_at <= CURRENT_TIMESTAMP
           THEN 1 ELSE finmate_request_limits.hits + 1 END,
         resets_at = CASE WHEN finmate_request_limits.resets_at <= CURRENT_TIMESTAMP
           THEN CURRENT_TIMESTAMP + ($2::integer * INTERVAL '1 second') ELSE finmate_request_limits.resets_at END
       RETURNING hits, resets_at`,
      [id, windowSeconds]
    )
    if (rows[0].hits > limit) {
      const error = new Error('Too many requests. Wait before trying again.')
      error.code = 'RATE_LIMIT'
      error.status = 429
      error.retryAfter = Math.max(1, Math.ceil((new Date(rows[0].resets_at) - Date.now()) / 1000))
      throw error
    }
  }
}
