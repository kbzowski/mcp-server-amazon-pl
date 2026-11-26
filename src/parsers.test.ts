import assert from 'node:assert/strict'
import fs from 'node:fs'
import { test } from 'node:test'
import { cartSchema, parseCart } from './cart.js'
import { orderSchema, parseOrders } from './orders.js'
import { MOCKS_DIR } from './pages.js'
import { parseProductDetails, parseSearchResults, productDetailsSchema, searchResultSchema } from './products.js'
import { cookieFileSchema, detectDomain } from './session.js'

const fixture = (name: string) => fs.readFileSync(`${MOCKS_DIR}${name}`, 'utf-8')

test('parseCart reads items, prices and subtotal', () => {
  const cart = cartSchema.parse(parseCart(fixture('cart.html')))
  assert.equal(cart.isEmpty, false)
  assert.equal(cart.items.length, 2)
  assert.match(cart.items[0].title, /^Collagen Peptides/)
  for (const item of cart.items) {
    assert.match(item.asin ?? '', /^[A-Z0-9]{10}$/)
    assert.ok(item.price)
  }
})

test('parseCart treats a cart without rows as empty', () => {
  assert.deepEqual(parseCart('<div id="sc-active-cart"><h1>Your Amazon Cart is empty</h1></div>'), { isEmpty: true, items: [] })
})

test('parseOrders returns each order card once', () => {
  const orders = parseOrders(fixture('orders.html')).map(order => orderSchema.parse(order))
  assert.equal(orders.length, 10)
  assert.equal(new Set(orders.map(o => o.orderInfo.orderNumber)).size, 10)
  assert.ok(orders.every(o => o.orderInfo.orderNumber && o.items.length > 0))
})

test('parseProductDetails reads title, price and description', () => {
  const product = productDetailsSchema.parse(parseProductDetails(fixture('product.html'), 'B0DGHMNQ5Z'))
  assert.equal(product.asin, 'B0DGHMNQ5Z')
  assert.match(product.title, /^SAGUARO Barefoot/)
  assert.ok(product.price)
  assert.ok(product.mainImageUrl?.startsWith('https://'))
})

test('parseSearchResults reads up to 20 products and builds their URLs', () => {
  const results = parseSearchResults(fixture('search.html'), asin => `https://www.amazon.pl/-/en/gp/product/${asin}`)
  assert.equal(results.length, 20)
  for (const result of results) {
    searchResultSchema.parse(result)
    assert.equal(result.productUrl, `https://www.amazon.pl/-/en/gp/product/${result.asin}`)
    assert.ok(!/^(Sponsored Ad|Reklama sponsorowana)/.test(result.title))
  }
})

test('detectDomain prefers the marketplace cookie domain', () => {
  assert.equal(detectDomain(['www.amazon.pl', '.amazon.pl']), 'amazon.pl')
  assert.equal(detectDomain(['www.amazon.co.uk']), 'amazon.co.uk')
  assert.equal(detectDomain(['.example.com']), undefined)
})

test('cookieFileSchema accepts the example cookie file and rejects a non-array', () => {
  assert.ok(cookieFileSchema.safeParse(JSON.parse(fs.readFileSync(`${MOCKS_DIR}../amazonCookies.example.json`, 'utf-8'))).success)
  assert.equal(cookieFileSchema.safeParse({ cookies: [] }).success, false)
})
