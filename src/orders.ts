import * as cheerio from 'cheerio'
import { z } from 'zod'
import { fetchPage } from './pages.js'

export const orderSchema = z.object({
  orderInfo: z.object({
    orderNumber: z.string(),
    orderDate: z.string(),
    total: z.string(),
    deliveryAddress: z.object({ name: z.string(), address: z.string(), country: z.string() }),
    status: z.string(),
    collectionDate: z.string().nullable(),
  }),
  items: z.array(
    z.object({
      title: z.string(),
      image: z.string().optional(),
      productUrl: z.string().optional(),
      asin: z.string().nullable(),
      returnEligible: z.boolean(),
      returnDate: z.string().nullable(),
    })
  ),
})
export type Order = z.infer<typeof orderSchema>

export function parseOrders(html: string): Order[] {
  const $ = cheerio.load(html)
  return $('.order-card')
    .toArray()
    .map((card): Order => {
      const $card = $(card)
      const status = $card
        .find('.delivery-box__primary-text')
        .map((_, el) => $(el).text().trim())
        .get()
        .join('; ')
      const collectionMatch = status.match(/(?:Collected on|Odebrano w dniu:) ([^;]+)/)

      const $addressRow = $card.find('.a-popover-preload .a-row').eq(1)
      $addressRow.find('br').replaceWith(', ')

      const items = $card
        .find('.item-box')
        .toArray()
        .map(element => {
          const $element = $(element)
          const $titleLink = $element.find('.yohtmlc-product-title a')
          const productUrl = $titleLink.attr('href')
          const returnText = $element.find('.a-size-small').text().trim()
          const returnEligible = returnText.includes('Return or Replace Items') || returnText.includes('Zwróć')
          return {
            title: $titleLink.text().trim(),
            image: $element.find('.product-image img').attr('src'),
            productUrl,
            asin: productUrl?.match(/\/dp\/([A-Z0-9]{10})/)?.[1] ?? null,
            returnEligible,
            returnDate: (returnEligible && returnText.match(/(?:until|wygasa w dniu) (.+)/)?.[1]) || null,
          }
        })

      return {
        orderInfo: {
          orderNumber: $card.find('.yohtmlc-order-id span').last().text().trim(),
          orderDate: $card.find('.order-header__header-list-item').first().find('.a-size-base').text().trim(),
          total: $card.find('.order-header__header-list-item').eq(1).find('.a-size-base').text().trim(),
          deliveryAddress: {
            name: $card.find('.a-popover-preload h5').text().trim(),
            address: $addressRow.text().trim().replace(/\s+/g, ' '),
            country: $card.find('.a-popover-preload .a-row').last().text().trim(),
          },
          status,
          collectionDate: collectionMatch ? collectionMatch[1] : null,
        },
        items,
      }
    })
}

export async function getOrdersHistory(): Promise<Order[]> {
  return parseOrders(await fetchPage('orders'))
}
