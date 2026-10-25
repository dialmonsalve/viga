# viga docs

Documentation site for viga, built with [Astro](https://astro.build) and [Starlight](https://starlight.astro.build). It is a static site served by a Cloudflare Worker with static assets.

## Commands

Run them from the repository root:

| Command | What it does |
|---|---|
| `pnpm --filter docs dev` | Starts the dev server with live reload |
| `pnpm --filter docs build` | Builds the site into `docs/dist` |
| `pnpm --filter docs preview:cloudflare` | Builds and serves the site with Cloudflare's local runtime, to check the per-language 404 pages and `_redirects` |
| `pnpm --filter docs deploy` | Builds and deploys the site with Wrangler |

The dev server always shows the Spanish 404 page. Use `preview:cloudflare` to see the 404 page of each language.

## Structure

| Path | Content |
|---|---|
| `src/content/docs/{es,en,pt}/` | Documentation pages, one Markdown or MDX file per page and language. Spanish is the default language; a page missing in English or Portuguese falls back to Spanish with a notice |
| `src/content/docs/404.md` | Site-wide 404 page used by Starlight |
| `src/content/i18n/` | Overrides for Starlight's interface strings. Portuguese uses `pt-BR.json` |
| `src/pages/[lang]/` | Landing page and per-language 404 pages, outside Starlight |
| `src/i18n/` | Typed dictionaries for the landing and the 404 pages. Spanish defines the shape and the other languages use `satisfies Dictionary` |
| `src/components/starlight/` | Replacements for Starlight components: table of contents with the mascot, theme switcher and language menu |
| `src/components/Mascot.astro` | Animated mascot for the landing page |
| `src/assets/` | Logo, mascot and peeking mascot SVGs |
| `src/styles/custom.css` | Starlight accent colors |
| `public/_redirects` | Redirects `/` to `/es/` on Cloudflare |
| `wrangler.jsonc` | Cloudflare Worker configuration |

## Languages

The languages are Spanish (`/es/`), English (`/en/`) and Portuguese (`/pt/`, `pt-BR`). Adding one means updating `i18n`, the sitemap locales and `LANGS` in `astro.config.mjs`, `LANGS` in `src/i18n/index.ts`, and adding its dictionary folder in `src/i18n/`.
