import pg from 'pg'
import { createApp } from '../server.mjs'
import { PostgresStore } from '../backend/postgres-store.mjs'

let application

async function initialize() {
  const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL
  if (!connectionString) throw new Error('DATABASE_URL is required for hosted storage.')
  const databaseUrl = new URL(connectionString)
  if (!['postgres:', 'postgresql:'].includes(databaseUrl.protocol))
    throw new Error('Hosted storage requires PostgreSQL.')
  databaseUrl.searchParams.set('sslmode', 'verify-full')
  const publicOrigins = [
    ...new Set(
      [
        process.env.FINMATE_PUBLIC_ORIGIN,
        process.env.VERCEL_PROJECT_PRODUCTION_URL &&
          `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`,
        process.env.VERCEL_URL && `https://${process.env.VERCEL_URL}`,
      ].filter(Boolean)
    ),
  ]
  const database = new pg.Pool({
    connectionString: databaseUrl.toString(),
    max: 3,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 10000,
  })
  database.on('error', () => console.error('Database connection interrupted.'))
  try {
    const store = await new PostgresStore(database, process.env.FINMATE_STORAGE_KEY).init()
    return await createApp({ store, hosted: true, publicOrigins })
  } catch (error) {
    await database.end()
    throw error
  }
}

export default async function handler(req, res) {
  try {
    application ||= initialize().catch(error => {
      application = null
      throw error
    })
    return await (await application).handler(req, res)
  } catch {
    res.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
    res.end(
      JSON.stringify({
        error: 'Hosted storage is unavailable. Please try again later.',
        code: 'STORAGE_UNAVAILABLE',
      })
    )
  }
}
