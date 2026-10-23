import type { RequestHandler } from 'express';
import { createContextKey } from '../context.ts';
import { interpolate, type MessageParams, type MessageResolver } from '../http/messages.ts';
import { BUILT_IN_CATALOGS, BUILT_IN_DEFAULT_LOCALE } from './messages.ts';
import { negotiateLocale } from './negotiate.ts';
import { diagnostic } from '../diagnostics.ts';

export type Catalog = { readonly [key: string]: string | Catalog };

export interface I18nOptions {
  catalogs?: Readonly<Record<string, Catalog>>;
  defaultLocale?: string;
}

const LOCALE = createContextKey<string>('locale');

export function currentLocale(): string | undefined {
  return LOCALE.find();
}

export function runWithLocale<T>(locale: string, fn: () => T): T {
  return LOCALE.run(locale, fn);
}

function lookup(catalog: Catalog | undefined, key: string): string | undefined {
  let node: unknown = catalog;
  for (const segment of key.split('.')) {
    if (typeof node !== 'object' || node === null || !Object.hasOwn(node, segment)) {
      return undefined;
    }
    node = (node as Record<string, unknown>)[segment];
  }
  return typeof node === 'string' ? node : undefined;
}

export class I18n {
  readonly locales: readonly string[];
  readonly defaultLocale: string;
  private readonly catalogs: Readonly<Record<string, Catalog>>;

  constructor({ catalogs, defaultLocale }: I18nOptions = {}) {
    this.catalogs = catalogs ?? {};
    this.locales = catalogs ? Object.keys(catalogs) : Object.keys(BUILT_IN_CATALOGS);
    this.defaultLocale = defaultLocale ?? this.locales[0] ?? BUILT_IN_DEFAULT_LOCALE;

    if (!this.locales.includes(this.defaultLocale)) {
      throw new Error(
        diagnostic('i18n.unknownDefaultLocale', {
          locale: this.defaultLocale,
          locales: this.locales.join(', '),
        })
      );
    }
  }

  readonly middleware: RequestHandler = (req, res, next) => {
    const locale = this.negotiate(req.headers['accept-language']);
    res.setHeader('Content-Language', locale);
    runWithLocale(locale, next);
  };

  readonly resolveMessage: MessageResolver = (code, params) =>
    this.has(code) ? this.t(code, params) : undefined;

  locale(): string {
    const locale = currentLocale();
    return locale !== undefined && this.locales.includes(locale) ? locale : this.defaultLocale;
  }

  t(key: string, params?: MessageParams): string {
    return this.translate(this.locale(), key, params);
  }

  negotiate(acceptLanguage: string | readonly string[] | null | undefined): string {
    return negotiateLocale(acceptLanguage, this.locales, this.defaultLocale);
  }

  has(key: string): boolean {
    return this.find(this.defaultLocale, key) !== undefined;
  }

  translate(locale: string, key: string, params: MessageParams = {}): string {
    const template =
      this.find(locale, key) ??
      this.find(this.defaultLocale, key) ??
      lookup(BUILT_IN_CATALOGS[BUILT_IN_DEFAULT_LOCALE], key) ??
      key;
    return interpolate(template, params);
  }

  private find(locale: string, key: string) {
    return lookup(this.catalogs[locale], key) ?? lookup(BUILT_IN_CATALOGS[locale], key);
  }
}
