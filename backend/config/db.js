import pg from 'pg'
import { readFileSync } from 'node:fs'
import { env } from './env.js'

const { Pool } = pg

const pool = new Pool({
  connectionString: env.DATABASE_URL,
  // Keep a reasonable pool size for a student/portfolio project.
  // Render.com free tier and Railway free tier both allow ~5 connections.
  max: 5,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  // Parse TIMESTAMPTZ columns as JS Date objects automatically
  // (pg returns them as strings by default)
})

pool.on('error', (err) => {
  console.error('[db] Unexpected pool error:', err.message)
})

// Thin wrapper: gives controllers a single-call query function
export const query = (text, params) => pool.query(text, params)

// Test the connection on startup so we fail fast if DATABASE_URL is wrong
export const connectDB = async () => {
  const client = await pool.connect()
  await client.query('SELECT 1')
  client.release()
  console.log('[db] PostgreSQL connected ✓')
}

// Tables are created on the first request of a fresh database (Neon), so no
// setup command has to be run against the live database.
let schemaReady = null
const sql = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
export const ensureSchema = () => {
  if (!schemaReady) {
    schemaReady = (async () => {
      const has = await pool.query("SELECT to_regclass('public.users') AS t")
      if (has.rows[0].t === null) {
        await pool.query(sql('schema.sql'))
        await pool.query(sql('migration_decimals.sql'))
        console.log('[db] tables created')
      }
      await pool.query(sql('migration_wall_height.sql'))
    })().catch((err) => { schemaReady = null; throw err })
  }
  return schemaReady
}

export default pool
