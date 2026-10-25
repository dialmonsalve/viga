function parseAcceptLanguage(header: string): string[] {
  return header
    .split(',')
    .map((part, index) => {
      const [tag = '', ...params] = part.trim().split(';');
      const quality = params.map((param) => param.trim()).find((param) => param.startsWith('q='));
      return { tag: tag.trim(), q: quality ? Number(quality.slice(2)) : 1, index };
    })
    .filter(({ tag, q }) => tag !== '' && tag !== '*' && q > 0)
    .sort((a, b) => b.q - a.q || a.index - b.index)
    .map(({ tag }) => tag);
}

export function matchLocale(
  preferences: string | readonly string[] | null | undefined,
  supported: readonly string[]
): string | undefined {
  const tags =
    typeof preferences === 'string' ? parseAcceptLanguage(preferences) : (preferences ?? []);

  for (const tag of tags) {
    const language = tag.toLowerCase().split('-')[0] ?? '';
    if (supported.includes(language)) return language;
  }
  return undefined;
}

export function negotiateLocale(
  preferences: string | readonly string[] | null | undefined,
  supported: readonly string[],
  fallback: string
): string {
  return matchLocale(preferences, supported) ?? fallback;
}
