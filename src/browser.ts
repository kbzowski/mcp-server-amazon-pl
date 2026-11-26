import { launch, type CookieData, type Page } from 'puppeteer'
import { getCookies } from './session.js'

export const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36'

const SAME_SITE: Record<string, CookieData['sameSite']> = { strict: 'Strict', lax: 'Lax', none: 'None', no_restriction: 'None' }

export const STEALTH_ARGS = ['--no-sandbox', '--disable-blink-features=AutomationControlled']

/** Opens a cookie-authenticated page, runs `fn`, and always closes the browser. BROWSER_VISIBLE=true shows the window. */
export async function withPage<T>(fn: (page: Page) => Promise<T>): Promise<T> {
  if (process.env.USE_MOCK_RESPONSES === 'true')
    throw new Error('Not available in mock mode (USE_MOCK_RESPONSES=true): this action needs the live Amazon cart.')
  const browser = await launch({
    headless: process.env.BROWSER_VISIBLE !== 'true',
    args: [...STEALTH_ARGS, '--disable-setuid-sandbox', '--disable-web-security'],
    ignoreDefaultArgs: ['--enable-automation'],
    defaultViewport: null,
  })
  try {
    await browser.setCookie(
      ...getCookies().map(cookie => ({ ...cookie, sameSite: SAME_SITE[cookie.sameSite?.toLowerCase() ?? ''] ?? 'Lax' }))
    )
    const page = await browser.newPage()
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
    })
    await page.setUserAgent({ userAgent: USER_AGENT })
    await page.setViewport({ width: 1366, height: 768 })
    return await fn(page)
  } finally {
    await browser.close()
  }
}

export async function throwIfNotLoggedIn(page: Page): Promise<void> {
  const isLoginPage = (await page.$('#ap_email')) !== null || (await page.$('#signInSubmit')) !== null
  if (isLoginPage) {
    throw new Error('You need to be logged in to access this feature. Please log in to Amazon first and then try again.')
  }
}
