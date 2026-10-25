// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

import sitemap from '@astrojs/sitemap';
import { rename, rm } from 'node:fs/promises';

const SITE = 'https://viga.dev';

const LANGS = ['es', 'en', 'pt'];

// https://astro.build/config
export default defineConfig({
  site: `${SITE}/`,
  i18n: {
    defaultLocale: 'es',
    locales: ['es', 'en', { path: 'pt', codes: ['pt-BR'] }],
    routing: {
      prefixDefaultLocale: true,
      redirectToDefaultLocale: false,
    },
  },
  integrations: [
    starlight({
      title: { es: 'viga', en: 'viga', 'pt-BR': 'viga' },
      customCss: ['./src/styles/custom.css'],
      components: {
        TableOfContents: './src/components/starlight/TableOfContents.astro',
        ThemeSelect: './src/components/starlight/ThemeSelect.astro',
        LanguageSelect: './src/components/starlight/LanguageSelect.astro',
      },
      logo: {
        light: './src/assets/logo-light.svg',
        dark: './src/assets/logo-dark.svg',
      },
      social: [
        {
          icon: 'github',
          label: 'GitHub',
          href: 'https://github.com/dialmonsalve/viga',
        },
      ],
      sidebar: [
        {
          label: 'Guías',
          translations: { en: 'Guides', 'pt-BR': 'Guias' },
          items: [
            // Each item here is one entry in the navigation menu.
            { label: 'Example Guide', slug: 'guides/example' },
          ],
        },
        {
          label: 'Referencia',
          translations: { en: 'Reference', 'pt-BR': 'Referência' },
          items: [{ autogenerate: { directory: 'reference' } }],
        },
      ],
    }),
    sitemap({
      filter: (page) => page !== `${SITE}/` && !page.endsWith('/404/'),
      i18n: {
        defaultLocale: 'es',
        locales: { es: 'es', en: 'en', pt: 'pt-BR' },
      },
    }),
    {
      name: 'localized-not-found',
      hooks: {
        'astro:build:done': async ({ dir }) => {
          for (const lang of LANGS) {
            const folder = new URL(`${lang}/404/`, dir);
            await rename(new URL('index.html', folder), new URL(`${lang}/404.html`, dir));
            await rm(folder, { recursive: true });
          }
        },
      },
    },
  ],
});
