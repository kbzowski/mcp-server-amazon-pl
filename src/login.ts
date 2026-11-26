// `pnpm amazon-login`: AMAZON_DOMAIN=amazon.pl, optional AMAZON_EMAIL / AMAZON_PASSWORD; CAPTCHA and OTP are finished by hand.
import fs from 'node:fs'
import { launch, type Page } from 'puppeteer'
import { STEALTH_ARGS, USER_AGENT } from './browser.js'
import { COOKIES_FILE_PATH, type CookieFile } from './session.js'

const EMAIL = process.env.AMAZON_EMAIL
const PASSWORD = process.env.AMAZON_PASSWORD
const DOMAIN = process.env.AMAZON_DOMAIN || 'amazon.com'
const POLL_INTERVAL_MS = 2000
const DEADLINE_MS = 15 * 60 * 1000

const DOMAIN_RE = new RegExp(DOMAIN.replace(/\./g, '\\.') + '$')
const SIGNIN_URL =
  `https://www.${DOMAIN}/ap/signin?_encoding=UTF8` +
  `&openid.return_to=https%3A%2F%2Fwww.${DOMAIN}%2F` +
  `&openid.identity=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0%2Fidentifier_select` +
  `&openid.assoc_handle=usflex` +
  `&openid.mode=checkid_setup` +
  `&openid.claimed_id=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0%2Fidentifier_select` +
  `&openid.ns=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0`

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

async function isLoggedIn(page: Page): Promise<boolean> {
  const url = page.url()
  if (!url || /\/ap\/(signin|mfa|cvf\/)/.test(url)) return false
  if (!DOMAIN_RE.test(new URL(url).hostname)) return false
  const greeting = await page.$eval('#nav-link-accountList-nav-line-1', el => el.textContent?.trim()).catch(() => null)
  return !!greeting && !/sign\s*in|zaloguj/i.test(greeting)
}

async function fillLoginForm(page: Page, email: string, password: string) {
  await page.waitForSelector('#ap_email, #ap_email_login', { timeout: 15000 })
  const emailSel = (await page.$('#ap_email')) ? '#ap_email' : '#ap_email_login'
  await page.click(emailSel, { count: 3 })
  await page.type(emailSel, email, { delay: 30 })
  const continueBtn = await page.$('#continue, #continue-announce')
  if (continueBtn) {
    await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}), continueBtn.click()])
  }
  await page.waitForSelector('#ap_password', { timeout: 10000 })
  await page.type('#ap_password', password, { delay: 30 })
  await (await page.$("input[name='rememberMe']"))?.click().catch(() => {})
  const signInBtn = await page.$('#signInSubmit')
  if (signInBtn) {
    await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}), signInBtn.click()])
  }
}

const browser = await launch({ headless: false, defaultViewport: null, args: [...STEALTH_ARGS, '--window-size=1280,900'] })
let browserClosed = false
browser.on('disconnected', () => {
  browserClosed = true
})

try {
  const [page] = await browser.pages()
  await page.setUserAgent({ userAgent: USER_AGENT })
  console.error(`[login] navigating to ${DOMAIN} sign-in…`)
  await page.goto(SIGNIN_URL, { waitUntil: 'domcontentloaded' })

  if (EMAIL && PASSWORD) {
    await fillLoginForm(page, EMAIL, PASSWORD).catch(() =>
      console.error('[login] auto-fill stopped early (CAPTCHA / OTP / unfamiliar layout). Finish manually in the open window.')
    )
  } else {
    console.error('[login] AMAZON_EMAIL / AMAZON_PASSWORD not set: log in manually in the browser window.')
  }
  console.error('[login] Finish any CAPTCHA / OTP / device check in the window. Cookies are saved once you are logged in.')

  const deadline = Date.now() + DEADLINE_MS
  while (!(await isLoggedIn(page))) {
    if (browserClosed) throw new Error('browser closed before login completed')
    if (Date.now() > deadline) throw new Error('timed out before detecting logged-in state')
    await sleep(POLL_INTERVAL_MS)
  }
  await sleep(1500)

  const client = await page.target().createCDPSession()
  const { cookies } = await client.send('Network.getAllCookies')
  const saved: CookieFile = cookies
    .filter(c => DOMAIN_RE.test(c.domain.replace(/^\./, '')))
    .map(c => ({
      domain: c.domain,
      hostOnly: !c.domain.startsWith('.'),
      httpOnly: c.httpOnly,
      name: c.name,
      path: c.path || '/',
      sameSite: c.sameSite ?? null,
      secure: c.secure,
      session: !(c.expires > 0),
      storeId: null,
      value: c.value,
      ...(c.expires > 0 && { expirationDate: c.expires }),
    }))
  fs.writeFileSync(COOKIES_FILE_PATH, JSON.stringify(saved, null, 2))
  console.error(`[login] wrote ${saved.length} ${DOMAIN} cookies to ${COOKIES_FILE_PATH}`)
} catch (error) {
  console.error('[login] error:', error)
  process.exitCode = browserClosed ? 2 : 1
} finally {
  await browser.close().catch(() => {})
}
