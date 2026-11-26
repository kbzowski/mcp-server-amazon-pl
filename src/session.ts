import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'

export const COOKIES_FILE_PATH = fileURLToPath(new URL('../amazonCookies.json', import.meta.url))

// Cookie-Editor export format, also written by `pnpm amazon-login`; extra keys pass through to Puppeteer untouched.
export const cookieFileSchema = z.array(
  z.looseObject({
    domain: z.string(),
    name: z.string(),
    value: z.string(),
    path: z.string(),
    httpOnly: z.boolean(),
    secure: z.boolean(),
    sameSite: z.string().nullable().optional(),
    expirationDate: z.number().optional(),
  })
)
export type CookieFile = z.infer<typeof cookieFileSchema>

let cookies: CookieFile | undefined

/** Cookies from amazonCookies.json, loaded and validated on first use. Throws if the file is missing or malformed. */
export function getCookies(): CookieFile {
  if (cookies) return cookies
  if (!fs.existsSync(COOKIES_FILE_PATH)) {
    throw new Error(`No amazonCookies.json file found at ${COOKIES_FILE_PATH}. Run \`pnpm login\` or export your cookies from the browser.`)
  }
  let json: unknown
  try {
    json = JSON.parse(fs.readFileSync(COOKIES_FILE_PATH, 'utf-8'))
  } catch (error) {
    throw new Error(`amazonCookies.json is not valid JSON: ${error instanceof Error ? error.message : error}`)
  }
  const parsed = cookieFileSchema.safeParse(json)
  if (!parsed.success) throw new Error(`amazonCookies.json has an unexpected format: ${z.prettifyError(parsed.error)}`)
  cookies = parsed.data
  console.error(`[INFO] Loaded ${cookies.length} Amazon cookies`)
  return cookies
}

export function detectDomain(cookieDomains: string[]): string | undefined {
  const domain = cookieDomains.find(d => d.startsWith('.amazon.')) ?? cookieDomains.find(d => d.includes('amazon'))
  return domain?.replace(/^\./, '').replace(/^www\./, '')
}

let domain: string | undefined

/** Marketplace domain, e.g. "amazon.pl": from the cookies, else AMAZON_DOMAIN, else amazon.com. Never throws. */
export function getAmazonDomain(): string {
  if (domain) return domain
  let fromCookies: string | undefined
  try {
    fromCookies = detectDomain(getCookies().map(c => c.domain))
  } catch (error) {
    console.error(`[WARN] ${error instanceof Error ? error.message : error}`)
  }
  domain = fromCookies ?? process.env.AMAZON_DOMAIN ?? 'amazon.com'
  console.error(`[INFO] Using Amazon domain ${domain}`)
  return domain
}
