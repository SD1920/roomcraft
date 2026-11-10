import './config/env.js'          // validates env vars first — fail fast
import { connectDB } from './config/db.js'
import app           from './app.js'
import { env }       from './config/env.js'

const start = async () => {
  await connectDB()   // bail immediately if DB is unreachable
  app.listen(env.PORT, () => {
    console.log(`[server] roomcraft backend running on port ${env.PORT} (${env.NODE_ENV})`)
    console.log(`[server] accepting requests from: ${env.CLIENT_URL}`)
  })
}

start().catch((err) => {
  console.error('[server] Fatal startup error:', err.message)
  process.exit(1)
})
