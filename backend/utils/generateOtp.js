import { randomInt } from 'crypto'

// crypto.randomInt uses the OS CSPRNG — not predictable like Math.random()
export const generateOtp = () => randomInt(10000, 100000).toString()

export const getOtpExpiry = (minutes = 10) =>
  new Date(Date.now() + minutes * 60 * 1000)
