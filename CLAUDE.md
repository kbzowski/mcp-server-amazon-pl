# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

This is an Amazon MCP (Model Context Protocol) Server that enables AI assistants to interact with Amazon services through web scraping. The server uses Puppeteer for browser automation and exposes Amazon functionality through MCP tools.

## Development Commands

```bash
pnpm install        # puppeteer build script is allowed via allowBuilds in pnpm-workspace.yaml
pnpm build          # tsc → build/
pnpm test           # offline parser tests against mocks/ (node:test)
pnpm amazon-login   # interactive login, writes amazonCookies.json (AMAZON_DOMAIN=amazon.pl)
pnpm clean          # delete timestamped page dumps in mocks/
```

## Architecture

- `src/index.ts`: MCP tools (`registerTool` with annotations, output schemas, `structuredContent`). Errors go through `toolError` (`isError: true`).
- `src/session.ts`: `amazonCookies.json` (lazy, zod-validated) and marketplace domain detection.
- `src/browser.ts`: `withPage` launches Chrome with cookies, stealth flags and user agent, and always closes it.
- `src/pages.ts`: page catalog (URL + ready selector per page kind) and `fetchPage`, the live/mock seam: live Chrome, or `mocks/<kind>.html` with `USE_MOCK_RESPONSES=true`. Live pages are dumped to `mocks/<kind>_<timestamp>.html` unless `EXPORT_MOCKS=false`.
- `src/cart.ts`, `src/orders.ts`, `src/products.ts`: zod output schemas (types derive from them), pure `parse*` functions (HTML string → data) and the tool functions. Cart actions check their outcome on the reloaded cart DOM and return the cart.
- `src/login.ts`: cookie login helper sharing the user agent, flags and cookie format.

Env: `USE_MOCK_RESPONSES`, `EXPORT_MOCKS`, `BROWSER_VISIBLE`, `AMAZON_DOMAIN` (fallback when cookies have no Amazon domain).

When Amazon changes its markup: save a fresh dump as `mocks/<kind>.html`, fix the parser until `pnpm test` passes. Never commit timestamped dumps; they contain account data (addresses, orders).

## MCP Tools Exposed

1. `search-products`: Search Amazon catalog
2. `get-product-details`: Get detailed product information
3. `get-orders-history`: View past orders
4. `get-cart-content`: View current cart
5. `add-to-cart`: Add items to cart
6. `remove-from-cart`: Remove a single item from the cart by ASIN (leaves other items untouched)
7. `clear-cart`: Remove all items from cart
8. `perform-purchase`: Stub, never buys anything

## Testing

- `pnpm test` covers the parsers, cookie validation and domain detection offline.
- Cart actions (`add-to-cart`, `remove-from-cart`, `clear-cart`) only run live; they change the real cart.
