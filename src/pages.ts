import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Page } from 'puppeteer'
import { throwIfNotLoggedIn, withPage } from './browser.js'
import { getAmazonDomain } from './session.js'

export const MOCKS_DIR = fileURLToPath(new URL('../mocks/', import.meta.url))

const PAGES = {
  cart: {
    path: () => '/-/en/gp/cart/view.html',
    ready: '#sc-active-cart, .sc-cart-item, .sc-empty-cart-banner',
    missing: 'cart container',
  },
  orders: { path: () => '/-/en/gp/css/order-history', ready: '.order-card, .your-orders-content-container', missing: 'orders list' },
  product: { path: (asin: string) => `/-/en/gp/product/${asin}`, ready: '#productTitle', missing: 'product title' },
  search: { path: (term: string) => `/s?k=${encodeURIComponent(term)}`, ready: '.s-search-results', missing: 'search results' },
} satisfies Record<string, { path: (arg: string) => string; ready: string; missing: string }>

export type PageKind = keyof typeof PAGES

export function pageUrl(kind: PageKind, arg = ''): string {
  return `https://www.${getAmazonDomain()}${PAGES[kind].path(arg)}`
}

export async function openPage(page: Page, kind: PageKind, arg = ''): Promise<void> {
  const url = pageUrl(kind, arg)
  console.error(`[INFO][${kind}] Opening ${url}`)
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 })
  await throwIfNotLoggedIn(page)
  try {
    await page.waitForSelector(PAGES[kind].ready, { timeout: 10000 })
  } catch {
    throw new Error(`Could not find the ${PAGES[kind].missing} on ${url}. Amazon may have changed the page or the session expired.`)
  }
}

function timestamp() {
  return new Date().toISOString().slice(0, 19).replace('T', '_').replaceAll(':', '-')
}

/**
 * Rendered HTML of an Amazon page. USE_MOCK_RESPONSES=true reads mocks/<kind>.html instead of launching Chrome.
 * Live pages are saved to mocks/<kind>_<timestamp>.html (same format the mock read expects) unless EXPORT_MOCKS=false.
 */
export async function fetchPage(kind: PageKind, arg = ''): Promise<string> {
  if (process.env.USE_MOCK_RESPONSES === 'true') {
    console.error(`[INFO][${kind}] Reading mocks/${kind}.html`)
    return fs.readFileSync(`${MOCKS_DIR}${kind}.html`, 'utf-8')
  }
  const html = await withPage(async page => {
    await openPage(page, kind, arg)
    return page.content()
  })
  if (process.env.EXPORT_MOCKS !== 'false') {
    const mockPath = `${MOCKS_DIR}${kind}_${timestamp()}.html`
    fs.writeFileSync(mockPath, html)
    console.error(`[INFO][${kind}] Exported page HTML to ${mockPath}`)
  }
  return html
}
