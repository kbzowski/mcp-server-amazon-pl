# Amazon MCP Server – wersja dla amazon.pl

Fork [NZX-DeSiGN/mcp-server-amazon](https://github.com/NZX-DeSiGN/mcp-server-amazon) dostosowany do **amazon.pl** i **Windowsa**. Serwer MCP pozwala Claude (lub innemu klientowi MCP) korzystać z Twojego konta Amazon: wyszukiwać produkty, przeglądać koszyk i historię zamówień.

Działa przez scraping (Puppeteer + Cheerio) z ciasteczkami Twojej sesji. Domena sklepu jest wykrywana z ciasteczek, więc po zalogowaniu na amazon.pl wszystkie zapytania idą na amazon.pl.

## Zmiany względem oryginału

- **Windows:** ścieżki budowane przez `fileURLToPath` zamiast `URL.pathname` (oryginał dawał `/C:/...` i nie znajdował `amazonCookies.json`).
- **Polska wersja strony:** amazon.pl ignoruje `/-/en/` w adresie i zwraca stronę po polsku. Dodane polskie odpowiedniki tekstów, po których serwer rozpoznaje stan strony:
  - „Reklama sponsorowana —” (oznaczanie reklam w wynikach wyszukiwania),
  - „Dodano do koszyka” (potwierdzenie dodania),
  - „Zwróć… Możliwość wygasa w dniu …” (możliwość i termin zwrotu w historii zamówień).
- **Skrypt logowania:** hasło nie jest wymagane w zmiennej środowiskowej, można zalogować się ręcznie w otwartym oknie. Polskie „Witamy, zaloguj się” nie jest już mylone ze stanem zalogowanym.

## Narzędzia

| Narzędzie | Opis | amazon.pl |
|---|---|---|
| `search-products` | wyszukiwanie produktów | ✅ |
| `get-product-details` | szczegóły produktu po ASIN | ✅ |
| `get-cart-content` | zawartość koszyka | ✅ |
| `add-to-cart` | dodanie produktu do koszyka | ✅ |
| `remove-from-cart` | usunięcie jednego produktu z koszyka | ✅ |
| `clear-cart` | wyczyszczenie koszyka | nietestowane |
| `get-orders-history` | ostatnie zamówienia | ✅ |
| `perform-purchase` | zakup – **atrapa**, niczego nie zamawia | – |

## Instalacja

Wymagany Node.js 22.12+ i pnpm.

```sh
git clone https://github.com/kbzowski/mcp-server-amazon-pl
cd mcp-server-amazon-pl
pnpm install
pnpm exec puppeteer browsers install chrome
pnpm build
```

Drugie polecenie jest potrzebne tylko wtedy, gdy pnpm zablokuje skrypt instalacyjny Puppeteera i Chrome nie zostanie pobrany.

## Logowanie

```sh
AMAZON_DOMAIN=amazon.pl pnpm amazon-login
```

W PowerShellu: `$env:AMAZON_DOMAIN="amazon.pl"; pnpm amazon-login`

Otworzy się okno Chrome. Zaloguj się (z CAPTCHA i kodem 2FA, jeśli Amazon o nie poprosi) i nie zamykaj okna – skrypt sam wykryje zalogowanie i zapisze ciasteczka do `amazonCookies.json`. Opcjonalnie można podać `AMAZON_EMAIL` i `AMAZON_PASSWORD`, wtedy formularz wypełni się sam.

`amazonCookies.json` zawiera aktywną sesję Twojego konta i jest w `.gitignore`. Nie publikuj go. Gdy sesja wygaśnie, uruchom skrypt ponownie.

## Podłączenie do Claude

**Claude Code:**

```sh
claude mcp add amazon -s user -- node /pelna/sciezka/do/mcp-server-amazon-pl/build/index.js
```

**Claude Desktop** (`%APPDATA%\Claude\claude_desktop_config.json` na Windowsie, `~/Library/Application Support/Claude/claude_desktop_config.json` na macOS):

```json
{
  "mcpServers": {
    "amazon": {
      "command": "node",
      "args": ["D:/sciezka/do/mcp-server-amazon-pl/build/index.js"]
    }
  }
}
```

Po zmianie konfiguracji uruchom klienta ponownie.

## Prywatność

Przy każdym wywołaniu serwer zapisuje pobrany HTML do `mocks/` (razem z danymi z zamówień, np. adresami dostawy). Pliki są w `.gitignore`. Żeby to wyłączyć, ustaw zmienną środowiskową `EXPORT_MOCKS=false` (w konfiguracji Claude Desktop: `"env": { "EXPORT_MOCKS": "false" }`). Stare pliki usuniesz przez `rm mocks/*_202*`.

## Rozwój

- `pnpm test` – testy parserów na plikach z `mocks/` (bez Chrome i bez ciasteczek).
- `USE_MOCK_RESPONSES=true` – serwer czyta `mocks/<strona>.html` zamiast łączyć się z Amazonem. Zrzut z prawdziwej strony (`mocks/<strona>_<data>.html`) wystarczy przemianować, żeby stał się nowym mockiem.
- `BROWSER_VISIBLE=true` – pokazuje okno przeglądarki.

## Problemy

- **„You need to be logged in”** – sesja wygasła, zaloguj się ponownie.
- **Puste wyniki lub błędy parsowania** – Amazon zmienił układ strony; selektory są w parserach w `src/products.ts`, `src/cart.ts`, `src/orders.ts`. Zapisz zrzut strony jako mock i popraw parser, aż `pnpm test` przejdzie.
- Szczegóły działania serwera widać w logach klienta MCP (w Claude Desktop: `%APPDATA%\Claude\logs\mcp-server-amazon.log`).

## Licencja

[MIT](./LICENSE), jak oryginał.
