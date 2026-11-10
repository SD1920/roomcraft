import { query } from '../config/db.js'

export const saveOnboardingResponse = async ({ userId, source, firstTime, wantsToShape }) => {
  // Upsert: if the user re-does onboarding, update instead of inserting a duplicate
  const result = await query(
    `INSERT INTO onboarding_responses (user_id, source, first_time, wants_to_shape)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id) DO UPDATE
       SET source         = EXCLUDED.source,
           first_time     = EXCLUDED.first_time,
           wants_to_shape = EXCLUDED.wants_to_shape
     RETURNING *`,
    [userId, source, firstTime, wantsToShape],
  )
  return result.rows[0]
}

export const getOnboardingResponse = async (userId) => {
  const result = await query(
    `SELECT * FROM onboarding_responses WHERE user_id = $1`,
    [userId],
  )
  return result.rows[0] || null
}
