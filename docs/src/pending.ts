import { readFileSync, readdirSync } from 'node:fs';

const LANGS = ['es', 'en', 'pt'];

export function pendingPaths(contentDir: URL): Set<string> {
  const paths = new Set<string>();

  for (const lang of LANGS) {
    const root = new URL(`${lang}/`, contentDir);
    for (const file of readdirSync(root, { recursive: true, encoding: 'utf8' })) {
      if (!/\.mdx?$/.test(file)) continue;

      const frontmatter = readFileSync(new URL(file, root), 'utf8').split(/^---$/m)[1] ?? '';
      if (!/^pending:\s*true\s*$/m.test(frontmatter)) continue;

      const slug = file.replace(/\.mdx?$/, '').replace(/(^|\/)index$/, '');
      for (const target of LANGS) paths.add(`/${target}/${slug}/`);
    }
  }

  return paths;
}
