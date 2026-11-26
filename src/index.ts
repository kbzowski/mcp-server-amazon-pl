import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { getOrdersHistory } from './orders.js'
import { getCartContent, addToCart, clearCart, removeFromCart } from './cart.js'
import { getProductDetails, searchProducts } from './products.js'

// Create server instance
const server = new McpServer({
  name: 'amazon',
  version: '1.0.0',
})

function toolError(tool: string, action: string, error: unknown): CallToolResult {
  console.error(`[ERROR][${tool}] Error in ${tool} tool:`, error)
  const message = error instanceof Error ? error.message : String(error)
  return {
    content: [{ type: 'text', text: `An error occurred while ${action}. Error: ${message}` }],
    isError: true,
  }
}

const asinInput = (purpose: string) =>
  z
    .string()
    .length(10, { error: 'ASIN must be a 10-character string.' })
    .describe(`The ASIN (Amazon Standard Identification Number) of the product to ${purpose}. Must be a 10-character string.`)

// Output schemas mirror the scraper return types; the `z.infer` annotations below make tsc catch drift.
const descriptionSchema = z.object({
  overview: z.string().optional(),
  features: z.string().optional(),
  facts: z.string().optional(),
  brandSnapshot: z.string().optional(),
})

const ordersOutput = z.object({
  orders: z.array(
    z.object({
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
  ),
})

const cartOutput = z.object({
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

const cartActionOutput = z.object({
  success: z.boolean(),
  message: z.string(),
  itemsRemoved: z.number().optional(),
})

const productDetailsOutput = z.object({
  asin: z.string(),
  title: z.string(),
  price: z.string(),
  canUseSubscribeAndSave: z.boolean(),
  description: descriptionSchema,
  reviews: z.object({ averageRating: z.string().optional(), reviewsCount: z.string().optional() }),
  mainImageUrl: z.string().optional(),
})

const searchOutput = z.object({
  products: z.array(
    z.object({
      asin: z.string(),
      title: z.string(),
      isSponsored: z.boolean(),
      brand: z.string().optional(),
      price: z.string().optional(),
      pricePerUnit: z.string().optional(),
      description: descriptionSchema.optional(),
      reviews: z.object({ averageRating: z.string().optional(), reviewCount: z.string().optional() }).optional(),
      imageUrl: z.string().optional(),
      isPrimeEligible: z.boolean(),
      deliveryInfo: z.string().optional(),
      productUrl: z.string().optional(),
    })
  ),
})

const readOnly = { readOnlyHint: true, openWorldHint: true }

server.registerTool(
  'get-orders-history',
  {
    title: 'Get orders history',
    description: 'Get orders history for a user',
    outputSchema: ordersOutput,
    annotations: readOnly,
  },
  async () => {
    let structuredContent: z.infer<typeof ordersOutput>
    try {
      structuredContent = { orders: await getOrdersHistory() }
    } catch (error) {
      return toolError('get-orders-history', 'retrieving orders history', error)
    }

    const { orders } = structuredContent
    return {
      content: [{ type: 'text', text: orders.length === 0 ? 'No orders found.' : JSON.stringify(orders, null, 2) }],
      structuredContent,
    }
  }
)

server.registerTool(
  'get-cart-content',
  {
    title: 'Get cart content',
    description: 'Get the current cart content for a user - Always provide the product link when you mention a product in the response',
    outputSchema: cartOutput,
    annotations: readOnly,
  },
  async () => {
    let structuredContent: z.infer<typeof cartOutput>
    try {
      structuredContent = await getCartContent()
    } catch (error) {
      return toolError('get-cart-content', 'retrieving cart content', error)
    }

    return {
      content: [
        { type: 'text', text: structuredContent.isEmpty ? 'Your Amazon cart is empty.' : JSON.stringify(structuredContent, null, 2) },
      ],
      structuredContent,
    }
  }
)

server.registerTool(
  'add-to-cart',
  {
    title: 'Add to cart',
    description: 'Add a product to the Amazon cart using ASIN - You should always ask for confirmation to the user before running this tool',
    inputSchema: { asin: asinInput('add to cart') },
    outputSchema: cartActionOutput,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  async ({ asin }) => {
    let structuredContent: z.infer<typeof cartActionOutput>
    try {
      structuredContent = await addToCart(asin)
    } catch (error) {
      return toolError('add-to-cart', 'adding product to cart', error)
    }

    const { success, message } = structuredContent
    return {
      content: [{ type: 'text', text: success ? `✅ ${message}` : `❌ Failed to add product to cart: ${message}` }],
      structuredContent,
      isError: !success,
    }
  }
)

server.registerTool(
  'remove-from-cart',
  {
    title: 'Remove from cart',
    description:
      'Remove a single item from the Amazon cart by its ASIN, leaving all other items untouched - ' +
      'Use this instead of clear-cart when you only want to drop or swap specific products. ' +
      'You should always ask for confirmation to the user before running this tool',
    inputSchema: { asin: asinInput('remove from the cart') },
    outputSchema: cartActionOutput,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  },
  async ({ asin }) => {
    let structuredContent: z.infer<typeof cartActionOutput>
    try {
      structuredContent = await removeFromCart(asin)
    } catch (error) {
      return toolError('remove-from-cart', 'removing the item from cart', error)
    }

    const { success, message } = structuredContent
    return {
      content: [{ type: 'text', text: success ? `✅ ${message}` : `❌ ${message}` }],
      structuredContent,
      isError: !success,
    }
  }
)

server.registerTool(
  'clear-cart',
  {
    title: 'Clear cart',
    description: 'Clear all items from the Amazon cart',
    outputSchema: cartActionOutput,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  },
  async () => {
    let structuredContent: z.infer<typeof cartActionOutput>
    try {
      structuredContent = await clearCart()
    } catch (error) {
      return toolError('clear-cart', 'clearing the cart', error)
    }

    return {
      content: [{ type: 'text', text: structuredContent.message }],
      structuredContent,
    }
  }
)

server.registerTool(
  'get-product-details',
  {
    title: 'Get product details',
    description:
      'Get detailed information about a product using its ASIN - Always provide the product link when you mention a product in the response',
    inputSchema: { asin: asinInput('get details for') },
    outputSchema: productDetailsOutput,
    annotations: readOnly,
  },
  async ({ asin }) => {
    let result: Awaited<ReturnType<typeof getProductDetails>>
    try {
      result = await getProductDetails(asin)
    } catch (error) {
      return toolError('get-product-details', 'retrieving product details', error)
    }

    const structuredContent: z.infer<typeof productDetailsOutput> = result.data
    const text = { type: 'text' as const, text: JSON.stringify(structuredContent, null, 2) }
    return {
      content: result.mainImageBase64 ? [text, { type: 'image', data: result.mainImageBase64, mimeType: 'image/jpeg' }] : [text],
      structuredContent,
    }
  }
)

server.registerTool(
  'search-products',
  {
    title: 'Search products',
    description:
      'Search for products on Amazon using a search term - Returns a list of products matching the search term - Always provide the product link when you mention a product in the response',
    inputSchema: {
      searchTerm: z
        .string()
        .min(1, { error: 'Search term cannot be empty.' })
        .describe('The search term to look for products on Amazon. For example: "collagen", "laptop", "books"'),
    },
    outputSchema: searchOutput,
    annotations: readOnly,
  },
  async ({ searchTerm }) => {
    let structuredContent: z.infer<typeof searchOutput>
    try {
      structuredContent = { products: await searchProducts(searchTerm) }
    } catch (error) {
      return toolError('search-products', 'searching for products', error)
    }

    const { products } = structuredContent
    return {
      content: [
        {
          type: 'text',
          text: products.length === 0 ? `No products found for search term "${searchTerm}".` : JSON.stringify(products, null, 2),
        },
      ],
      structuredContent,
    }
  }
)

server.registerTool(
  'perform-purchase',
  {
    title: 'Perform purchase',
    description:
      'Checkout with the current cart and complete the purchase - ' +
      'Before purchasing, you should verify in the cart content that your are not buying another product that was already there. ' +
      'If there are other products, clear the cart then add the items that the user want to buy again to the cart. ' +
      'Eventually you can purchase. ' +
      'You should always ask for confirmation to the user before running this tool',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  },
  async () => {
    // Mock the purchase confirmation for demonstration purposes
    return {
      content: [
        {
          type: 'text',
          text: '✅ Purchase confirmed! You can now consult your orders history to see the details of your latest purchase.',
        },
      ],
    }
  }
)

// Start the server
async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error('[INFO] Amazon MCP Server running on stdio')
}

main().catch(error => {
  console.error('[ERROR] Fatal error in main():', error)
  process.exit(1)
})
