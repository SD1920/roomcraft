import { saveOnboardingResponse } from '../models/onboardingModel.js'
import { markOnboardingComplete }  from '../models/userModel.js'

// ── POST /api/onboarding ──────────────────────────────────────
// Accepts: { source, firstTime, wantsToShape }
// Called from Onboarding.jsx after the user completes 3 steps.
// Protected route — requires JWT.
export const completeOnboarding = async (req, res) => {
  try {
    const { source, firstTime, wantsToShape } = req.body

    // source is a string — one of the options from the frontend
    const VALID_SOURCES = ['Instagram', 'A friend', 'College/campus', 'LinkedIn', 'Other']
    if (!source || !VALID_SOURCES.includes(source))
      return res.status(400).json({ message: 'Please select how you heard about us.' })

    if (typeof firstTime !== 'boolean' && firstTime !== 'Yes, first time' && firstTime !== "No, I've used similar apps")
      return res.status(400).json({ message: 'Please answer whether this is your first time.' })

    // Frontend sends strings like "Yes, count me in" / "No thanks"
    // Normalise to boolean for DB storage
    const firstTimeBool    = firstTime === true || firstTime === 'Yes, first time'
    const wantsToShapeBool = wantsToShape === true || wantsToShape === 'Yes, count me in'

    await saveOnboardingResponse({
      userId:        req.user.id,
      source,
      firstTime:     firstTimeBool,
      wantsToShape:  wantsToShapeBool,
    })

    // Mark the user as having completed onboarding so the frontend
    // knows not to redirect them here again on next login
    await markOnboardingComplete(req.user.id)

    return res.status(200).json({ message: 'Onboarding complete.', onboarding_complete: true })
  } catch (err) {
    console.error('[completeOnboarding]', err)
    return res.status(500).json({ message: 'Something went wrong.' })
  }
}
