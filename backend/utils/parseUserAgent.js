const MAX_UA_LENGTH = 512

export const sanitizeUserAgent = (rawUa) => {
  if (!rawUa || typeof rawUa !== 'string') return null
  const cleaned = rawUa.replace(/[^\x20-\x7E]/g, '').trim()
  return cleaned.slice(0, MAX_UA_LENGTH) || null
}

export const parseUserAgent = (userAgent) => {
  const safeUa = sanitizeUserAgent(userAgent)
  if (!safeUa) return { device: 'Unknown', browser: 'Unknown', sanitized: null }

  const ua = safeUa.toLowerCase()

  let device = 'Desktop'
  if (/mobile|iphone|android.*mobile/.test(ua)) device = 'Mobile'
  else if (/ipad|tablet|android(?!.*mobile)/.test(ua)) device = 'Tablet'

  let browser = 'Other'
  if (ua.includes('edg/'))                                browser = 'Edge'
  else if (ua.includes('chrome/') && !ua.includes('edg/')) browser = 'Chrome'
  else if (ua.includes('firefox/'))                        browser = 'Firefox'
  else if (ua.includes('safari/') && !ua.includes('chrome/')) browser = 'Safari'

  return { device, browser, sanitized: safeUa }
}
