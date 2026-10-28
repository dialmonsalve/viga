// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

import sitemap from '@astrojs/sitemap';
import { rename, rm } from 'node:fs/promises';
import { sidebar } from './src/sidebar';

const SITE = 'https://vigajs.dev';

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
        Head: './src/components/starlight/Head.astro',
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
      sidebar,
    }),
    sitemap({
      filter: (page) => page !== `${SITE}/` && !page.endsWith('/404/'),
      i18n: {
        defaultLocale: 'es',
        locales: { es: 'es', en: 'en', pt: 'pt-BR' },
      },
    }),
    {
      name: 'watch-sidebar',
      hooks: {
        'astro:config:setup': ({ addWatchFile }) => {
          addWatchFile(new URL('./src/sidebar.ts', import.meta.url));
        },
      },
    },
    {
      name: 'localized-not-found',
      hooks: {
        'astro:build:done': async ({ dir }) => {
          for (const lang of LANGS) {
            const folder = new URL(`${lang}/404/`, dir);
            await rename(
              new URL('index.html', folder),
              new URL(`${lang}/404.html`, dir)
            );
            await rm(folder, { recursive: true });
          }
        },
      },
    },
  ],
});
