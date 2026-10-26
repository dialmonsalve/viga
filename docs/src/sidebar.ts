import type { StarlightUserConfig } from '@astrojs/starlight/types';

type Sidebar = NonNullable<StarlightUserConfig['sidebar']>;

interface Labels {
  es: string;
  en: string;
  pt: string;
}

function section(directory: string, { es, en, pt }: Labels): Sidebar[number] {
  return {
    label: es,
    translations: { en, 'pt-BR': pt },
    items: [{ autogenerate: { directory } }],
  };
}

export const sidebar: Sidebar = [
  section('start', { es: 'Empezar', en: 'Getting started', pt: 'Começar' }),
  
];
