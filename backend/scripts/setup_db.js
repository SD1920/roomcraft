// One-time local database setup: `npm run setup-db`
//
// Creates the database named in DATABASE_URL (if it does not exist yet) and
// its tables from schema.sql. Safe to run again: an existing database and
// tables are left as they are, apart from the wall_height column, which is
// added if missing (migration_wall_height.sql).

import 'dotenv/config'
import { readFileSync } from 'node:fs'
import pg from 'pg'

const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL is not set in backend/.env')
  process.exit(1)
}

const target = new URL(url)
const dbName = decodeURIComponent(target.pathname.slice(1))
if (!/^[A-Za-z0-9_]+$/.test(dbName)) {
  console.error(`Unexpected database name "${dbName}" in DATABASE_URL`)
  process.exit(1)
}

// 1. the database itself, from the server's default "postgres" database
const admin = new URL(url)
admin.pathname = '/postgres'
const server = new pg.Client({ connectionString: admin.toString() })
try {
  await server.connect()
} catch (e) {
  console.error(`Could not connect to Postgres at ${target.host}: ${e.message}`)
  console.error('Check the user, password and port in DATABASE_URL (a local install usually uses port 5432).')
  process.exit(1)
}
const exists = await server.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName])
if (exists.rowCount === 0) {
  await server.query(`CREATE DATABASE ${dbName}`)
  console.log(`Created database ${dbName}`)
} else {
  console.log(`Database ${dbName} already exists`)
}
await server.end()

// 2. the tables
const db = new pg.Client({ connectionString: url })
await db.connect()
const hasUsers = await db.query("SELECT to_regclass('public.users') AS t")
if (hasUsers.rows[0].t === null) {
  await db.query(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'))
  console.log('Created the tables from schema.sql')
} else {
  await db.query(readFileSync(new URL('../migration_wall_height.sql', import.meta.url), 'utf8'))
  console.log('Tables already exist; made sure designs.wall_height is there')
}
await db.query(readFileSync(new URL('../migration_decimals.sql', import.meta.url), 'utf8'))
console.log('Room sizes and wall height keep up to 4 decimals')
const tables = await db.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY 1")
console.log('Tables:', tables.rows.map((r) => r.table_name).join(', '))
await db.end()
