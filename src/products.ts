import fs from 'node:fs'
import * as cheerio from 'cheerio'
import { z } from 'zod'
import { fetchPage, MOCKS_DIR, pageUrl } from './pages.js'

const reviewsSchema = z.object({ averageRating: z.string().optional(), reviewCount: z.string().optional() })

export const productDetailsSchema = z.object({
  asin: z.string(),
  title: z.string(),
  price: z.string(),
  canUseSubscribeAndSave: z.boolean(),
  description: z.object({
    overview: z.string().optional(),
    features: z.string().optional(),
    facts: z.string().optional(),
    brandSnapshot: z.string().optional(),
  }),
  reviews: reviewsSchema,
  mainImageUrl: z.string().optional(),
})
export type ProductDetails = z.infer<typeof productDetailsSchema>

export const searchResultSchema = z.object({
  asin: z.string(),
  title: z.string(),
  isSponsored: z.boolean(),
  brand: z.string().optional(),
  price: z.string().optional(),
  pricePerUnit: z.string().optional(),
  reviews: reviewsSchema.optional(),
  imageUrl: z.string().optional(),
  isPrimeEligible: z.boolean(),
  deliveryInfo: z.string().optional(),
  productUrl: z.string(),
})
export type SearchResult = z.infer<typeof searchResultSchema>

export function parseProductDetails(html: string, asin: string): ProductDetails {
  const $ = cheerio.load(html)
  const innerText = (selector: string) => $(selector).prop('innerText')?.trim() || undefined
  const subscriptionPrice = innerText('#subscriptionPrice .a-price .a-offscreen')
  const reviewsLabel = $('#acrCustomerReviewLink span').attr('aria-label')

  return {
    asin,
    title: $('span#productTitle').text().trim(),
    price: subscriptionPrice ?? $('.priceToPay').text().trim(),
    canUseSubscribeAndSave: subscriptionPrice !== undefined,
    description: {
      overview: innerText('#productOverview_feature_div'),
      features: innerText('#featurebullets_feature_div'),
      facts: innerText('#productFactsDesktop_feature_div'),
      brandSnapshot: innerText('#brandSnapshot_feature_div'),
    },
    reviews: {
      averageRating: $('#averageCustomerReviews span.a-size-small.a-color-base').first().text().trim() || undefined,
      reviewCount:
        reviewsLabel
          ?.replace(/\s+.*$/g, '')
          .replace(/,/g, '')
          .trim() || undefined,
    },
    mainImageUrl: $('#main-image-container img.a-dynamic-image').attr('src'),
  }
}

export async function getProductDetails(asin: string): Promise<{ data: ProductDetails; mainImageBase64?: string }> {
  const data = parseProductDetails(await fetchPage('product', asin), asin)
  // Only the mock adapter has an image; live download is off until clients render image results (see git history).
  const mainImageBase64 =
    data.mainImageUrl && process.env.USE_MOCK_RESPONSES === 'true'
      ? fs.readFileSync(`${MOCKS_DIR}product_image_base64.txt`, 'utf-8')
      : undefined
  console.error(`[INFO][get-product-details] Extracted ${asin}: ${data.title}, ${data.price}`)
  return { data, mainImageBase64 }
}

const SPONSORED_PREFIX = /^(Sponsored Ad|Reklama sponsorowana) [–—] /

export function parseSearchResults(html: string, productUrl: (asin: string) => string): SearchResult[] {
  const $ = cheerio.load(html)
  return $('[role="listitem"]')
    .slice(0, 20)
    .toArray()
    .flatMap((element, index): SearchResult[] => {
      const $item = $(element)
      const asin = $item.attr('data-asin')
      if (!asin) return []
      try {
        const fullTitle = $item.find('h2[aria-label]').attr('aria-label') || ''

        let pricePerUnit: string | undefined
        const $unitPrice = $item.find('span.a-price[data-a-size="b"][data-a-color="secondary"] > span.a-offscreen')
        if ($unitPrice.length > 0) {
          // each price is rendered twice (a-offscreen + aria-hidden copy); drop the copy
          const $priceBlock = $unitPrice.parent().parent().clone()
          $priceBlock.find('[aria-hidden="true"]').remove()
          pricePerUnit = $priceBlock.text().replace(/\s+/g, ' ').trim() || undefined
        }

        const averageRating = $item.find('i.a-icon-star-mini span.a-icon-alt').text().trim() || undefined
        const reviewCount = $item.find('a[aria-label*="ratings"] span.a-size-small').text().trim() || undefined

        return [
          {
            asin,
            title: fullTitle.replace(SPONSORED_PREFIX, ''),
            isSponsored: SPONSORED_PREFIX.test(fullTitle),
            brand: $item.find('h2.a-size-mini span.a-size-base-plus.a-color-base').text().trim() || undefined,
            price: $item.find('span.a-price[data-a-size="xl"] > span.a-offscreen').text().trim() || undefined,
            pricePerUnit,
            reviews: averageRating || reviewCount ? { averageRating, reviewCount } : undefined,
            imageUrl: $item.find('img.s-image').attr('src') || undefined,
            isPrimeEligible: $item.find('i.a-icon-prime').length > 0,
            deliveryInfo: $item.find('div.udm-primary-delivery-message').text().trim() || undefined,
            productUrl: productUrl(asin),
          },
        ]
      } catch (error) {
        console.error(`[WARN][search-products] Skipping result ${index + 1}:`, error)
        return []
      }
    })
}

export async function searchProducts(searchTerm: string): Promise<SearchResult[]> {
  const results = parseSearchResults(await fetchPage('search', searchTerm), asin => pageUrl('product', asin))
  console.error(`[INFO][search-products] Extracted ${results.length} products for "${searchTerm}"`)
  return results
}
