import * as cheerio from 'cheerio'
import type { Page } from 'puppeteer'
import { z } from 'zod'
import { throwIfNotLoggedIn, withPage } from './browser.js'
import { fetchPage, openPage, pageUrl } from './pages.js'

export const cartSchema = z.object({
  isEmpty: z.boolean(),
  items: z.array(
    z.object({
      title: z.string(),
      price: z.string(),
      quantity: z.number(),
      image: z.string().optional(),
      productUrl: z.string().optional(),
      asin: z.string().optional(),
      availability: z.string(),
      isSelected: z.boolean(),
    })
  ),
  subtotal: z.string().optional(),
  totalItems: z.number().optional(),
})
export type CartContent = z.infer<typeof cartSchema>

export const cartActionSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  cart: cartSchema.optional().describe('Cart content after the action, when it could be read'),
})
export type CartActionResult = z.infer<typeof cartActionSchema>

export function parseCart(html: string): CartContent {
  const $ = cheerio.load(html)
  const $cartContainer = $('#sc-active-cart')

  const $rows = $cartContainer.find('[data-asin]')
  // No rows means empty; rows we cannot parse are reported as a non-empty cart with no items.
  if ($rows.length === 0) return { isEmpty: true, items: [] }

  const items: CartContent['items'] = []
  $rows.each((_index, element) => {
    const $item = $(element)
    const title = $item.find('a.sc-product-title').first().find('.a-truncate-full').text().trim()
    const price = $item.find('.apex-price-to-pay-value .a-offscreen').text().trim()
    if (!title || !price) return
    items.push({
      title,
      price,
      quantity: parseInt($item.find('[data-a-selector="value"]').text().trim()) || 1,
      image: $item.find('.sc-product-image').attr('src'),
      productUrl: $item.find('.sc-product-link').attr('href'),
      asin: $item.attr('data-asin'),
      availability: $item.find('.sc-product-availability').text().trim() || 'Unknown',
      isSelected: $item.find('input[type="checkbox"]').is(':checked'),
    })
  })
  const subtotal =
    $cartContainer.find('#sc-subtotal-amount-activecart .sc-price').text().trim() ||
    $cartContainer.find('.sc-subtotal .sc-price').text().trim()
  const totalItemsMatch = $cartContainer.find('#sc-subtotal-label-activecart').text().trim().match(/\((\d+)\s+item/)

  return {
    isEmpty: false,
    items,
    subtotal,
    totalItems: totalItemsMatch ? parseInt(totalItemsMatch[1]) : items.length,
  }
}

export async function getCartContent(): Promise<CartContent> {
  return parseCart(await fetchPage('cart'))
}

const DELETE_BUTTON = 'span[data-action="delete-active"]'
const cartRow = (asin: string) => `#sc-active-cart [data-asin="${asin}"]`
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

// No ready-selector wait: an emptied cart may not render the selectors a filled one does.
async function reloadCart(page: Page): Promise<CartContent> {
  await page.goto(pageUrl('cart'), { waitUntil: 'networkidle2', timeout: 30000 })
  await throwIfNotLoggedIn(page)
  return parseCart(await page.content())
}

export async function addToCart(asin: string): Promise<CartActionResult> {
  return withPage(async page => {
    await openPage(page, 'product', asin)

    const oneTimePurchase = await page
      .waitForSelector(
        "::-p-xpath(//div[contains(@class, 'accordion-caption')]//span[contains(text(), 'One-time purchase')])",
        { timeout: 2000 }
      )
      .catch(() => null)
    if (oneTimePurchase) {
      console.error('[INFO][add-to-cart] Subscribe and save product, choosing one-time purchase')
      await oneTimePurchase.click()
      await sleep(2000)
    }

    try {
      await page.waitForSelector('#add-to-cart-button', { timeout: 10000 })
      await page.click('#add-to-cart-button')
    } catch (error) {
      throw new Error(`Could not find or click the add to cart button: ${error}`)
    }

    // Insurance upsell: decline it when it shows up.
    try {
      await page.waitForSelector('#productTitle', { timeout: 1000 })
      await page.click('#productTitle', { delay: 100 })
      await page.click('#attachSiNoCoverage', { delay: 300 })
    } catch {}

    // The confirmation decides success: the cart row ASIN can differ from the product page ASIN (variants).
    const confirmation = await page
      .waitForSelector('#sw-atc-confirmation', { timeout: 15000 })
      .then(el => el?.evaluate(node => node.textContent ?? ''))
      .catch(() => '')
    const success = ['Added to cart', 'Added to basket', 'Dodano do koszyka'].some(text => confirmation?.includes(text))

    return {
      success,
      message: success
        ? `Product ${asin} successfully added to cart`
        : `Could not confirm that product ${asin} was added to cart${confirmation ? `: ${confirmation.trim()}` : ''}`,
      // The add already happened; a failed cart read must not turn it into an error that invites a retry.
      cart: await reloadCart(page).catch(error => {
        console.error('[WARN][add-to-cart] Could not read the cart after adding:', error)
        return undefined
      }),
    }
  })
}

export async function removeFromCart(asin: string): Promise<CartActionResult> {
  return withPage(async page => {
    await openPage(page, 'cart')

    const deleteButton = await page.$(`${cartRow(asin)} ${DELETE_BUTTON}`)
    if (!deleteButton) {
      const inCart = (await page.$(cartRow(asin))) !== null
      return {
        success: false,
        message: inCart
          ? `Found ASIN ${asin} in cart but could not locate its delete button (Amazon DOM may have changed).`
          : `Item with ASIN ${asin} was not found in the active cart. Nothing removed.`,
        cart: parseCart(await page.content()),
      }
    }

    await deleteButton.click()
    await sleep(1500)
    const cart = await reloadCart(page)
    const success = (await page.$(cartRow(asin))) === null
    return {
      success,
      message: success ? `Successfully removed item ${asin} from cart.` : `Clicked delete for ASIN ${asin} but it still appears in the cart.`,
      cart,
    }
  })
}

export async function clearCart(): Promise<CartActionResult> {
  return withPage(async page => {
    await openPage(page, 'cart')

    const initialCount = (await page.$$(DELETE_BUTTON)).length
    for (let clicked = 0; clicked < initialCount; clicked++) {
      const button = await page.$(DELETE_BUTTON)
      if (!button) break
      await button.click().catch(error => console.error('[WARN][clear-cart] Delete click failed:', error))
      await sleep(800)
    }

    const cart = await reloadCart(page)
    const remaining = (await page.$$(DELETE_BUTTON)).length
    return {
      success: remaining === 0,
      message:
        remaining === 0
          ? `Cart cleared. Removed ${initialCount} items.`
          : `Removed ${initialCount - remaining} of ${initialCount} items; ${remaining} are still in the cart.`,
      cart,
    }
  })
}
