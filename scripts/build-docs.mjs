// Renders README.md/README.de.md and docs/en, docs/de as styled HTML into
// dist/web/docs/, so GitHub Pages serves the documentation next to the app.
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Marked } from 'marked';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'dist', 'web', 'docs');

// Single source of truth for which docs exist, in which language, and how
// they're labeled. This registry IS the completeness check: a doc needs
// both an `en` and a `de` entry below, unless marked `enOnly`.
const docs = [
  {
    slug: 'index',
    nav: { en: 'Guide', de: 'Anleitung' },
    title: { en: 'Schuldrad · Documentation', de: 'Schuldrad · Dokumentation' },
    src: { en: 'README.md', de: 'README.de.md' },
  },
  {
    slug: 'architecture',
    nav: { en: 'Architecture', de: 'Architektur' },
    title: { en: 'Schuldrad · Architecture', de: 'Schuldrad · Architektur' },
    src: { en: 'ARCHITECTURE.md', de: 'docs/de/architektur.md' },
  },
  {
    // English-only: SECURITY.md has no maintained translation (see its own
    // header). Exempted from the en/de pairing check below via `enOnly`.
    slug: 'security',
    nav: { en: 'Security', de: 'Sicherheit' },
    title: { en: 'Schuldrad · Security', de: 'Schuldrad · Security' },
    src: { en: 'SECURITY.md' },
    enOnly: true,
  },
  {
    slug: 'fairness',
    nav: { en: 'Fairness', de: 'Fairness' },
    title: { en: 'Schuldrad · Fairness', de: 'Schuldrad · Fairness' },
    src: { en: 'docs/en/fairness.md', de: 'docs/de/fairness.md' },
  },
  {
    slug: 'events',
    nav: { en: 'Events', de: 'Events' },
    title: { en: 'Schuldrad · Events', de: 'Schuldrad · Events' },
    src: { en: 'docs/en/events.md', de: 'docs/de/events.md' },
  },
  {
    slug: 'motion',
    nav: { en: 'Motion', de: 'Bewegung' },
    title: { en: 'Schuldrad · Motion', de: 'Schuldrad · Bewegung' },
    src: { en: 'docs/en/motion.md', de: 'docs/de/motion.md' },
  },
  {
    slug: 'deployment',
    nav: { en: 'Deployment', de: 'Betrieb' },
    title: { en: 'Schuldrad · Deployment', de: 'Schuldrad · Betrieb' },
    src: { en: 'docs/en/deployment.md', de: 'docs/de/deployment.md' },
  },
  {
    slug: 'contributing',
    nav: { en: 'Contributing', de: 'Mitwirken' },
    title: { en: 'Schuldrad · Contributing', de: 'Schuldrad · Mitwirken' },
    src: { en: 'docs/en/contributing.md', de: 'docs/de/contributing.md' },
  },
];

const LANGS = ['en', 'de'];

// Fail loudly if docs/en and docs/de (or README.md/README.de.md) drift out
// of pairing — either a stray file the registry doesn't know about, or a
// registry entry missing its counterpart on disk. Entries marked `enOnly`
// (currently just SECURITY.md, which has no maintained translation) are
// exempt from needing a `de` counterpart, explicitly, rather than needing
// a fake/duplicate `de` entry to satisfy the check.
async function checkCompleteness() {
  const problems = [];

  for (const doc of docs) {
    for (const lang of LANGS) {
      if (!doc.src[lang]) {
        if (!doc.enOnly) {
          problems.push(`docs registry entry '${doc.slug}' is missing a '${lang}' src.`);
        }
        continue;
      }
      const path = join(root, doc.src[lang]);
      try {
        await readFile(path);
      } catch {
        problems.push(
          `docs registry entry '${doc.slug}' names ${doc.src[lang]}, but it doesn't exist.`,
        );
      }
    }
  }

  for (const [dir, lang] of [
    ['docs/en', 'en'],
    ['docs/de', 'de'],
  ]) {
    let entries;
    try {
      entries = await readdir(join(root, dir));
    } catch {
      problems.push(`${dir} does not exist.`);
      continue;
    }
    const known = new Set(
      docs
        .filter((d) => d.slug !== 'index' && d.src[lang])
        .map((d) => d.src[lang].split('/').pop()),
    );
    for (const entry of entries) {
      if (entry.endsWith('.md') && !known.has(entry)) {
        problems.push(`${dir}/${entry} exists but has no counterpart entry in the docs registry.`);
      }
    }
  }

  if (problems.length > 0) {
    console.error('docs: language pairing is broken:');
    for (const p of problems) console.error(`  - ${p}`);
    console.error(
      "Every docs/en/*.md needs a docs/de/*.md counterpart (and vice versa), and README.md needs README.de.md. Fix the docs or scripts/build-docs.mjs's registry.",
    );
    process.exit(1);
  }
}

const slug = (text) =>
  text
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[^a-z0-9äöüß\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');

// Cross-links inside the Markdown source (README.md, docs/en/*.md, ...) are
// rewritten to point at the rendered page of whichever language the link's
// target file actually is — a link to an en source lands on the en page
// even from a de source page (and vice versa), so "Deutsch → architektur.md"
// and "English → ARCHITECTURE.md" cross over instead of self-linking.
function markedFor(lang) {
  return new Marked({
    gfm: true,
    renderer: {
      heading({ tokens, depth }) {
        const text = this.parser.parseInline(tokens);
        return `<h${depth} id="${slug(text)}">${text}</h${depth}>\n`;
      },
      link({ href, tokens }) {
        const text = this.parser.parseInline(tokens);
        if (/^(https?:)?\/\//.test(href) || href.startsWith('#')) {
          return `<a href="${href}">${text}</a>`;
        }
        const hrefBase = href.split('/').pop();
        const target = docs.find(
          (d) => d.src.en.split('/').pop() === hrefBase || d.src.de?.split('/').pop() === hrefBase,
        );
        if (target) {
          const targetLang = target.src.en.split('/').pop() === hrefBase ? 'en' : 'de';
          const path =
            target.slug === 'index' ? `${targetLang}/` : `${targetLang}/${target.slug}.html`;
          return `<a href="../${path}">${text}</a>`;
        }
        return `<a href="${href}">${text}</a>`;
      },
    },
  });
}

const css = `
:root {
  --ink: #282d37; --ink-soft: #646973; --rule: #d7dce1; --panel: #f0f3f5;
  --red: #ec0016;
  --font: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  --mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
}
* { box-sizing: border-box; }
body { margin: 0; font-family: var(--font); color: var(--ink); background: #fff; line-height: 1.55; font-size: 16px; }
.topbar { display: flex; align-items: center; gap: 2rem; border-bottom: 1px solid var(--rule); padding: 0 1rem; min-height: 56px; flex-wrap: wrap; }
.wordmark { font-weight: 800; font-size: 1.25rem; text-decoration: none; color: var(--ink); letter-spacing: -0.02em; }
.wordmark::before { content: ""; display: inline-block; width: 10px; height: 22px; background: var(--red); margin-right: 0.6rem; vertical-align: -4px; }
.tabs { display: flex; gap: 1.5rem; height: 56px; flex: 1; }
.tabs a { display: flex; align-items: center; text-decoration: none; color: var(--ink-soft); border-bottom: 3px solid transparent; font-weight: 600; }
.tabs a.active { color: var(--ink); border-bottom-color: var(--red); }
.lang-switch { display: flex; gap: 0.5rem; align-items: center; font-family: var(--mono); font-size: 0.8rem; }
.lang-switch a { text-decoration: none; color: var(--ink-soft); padding: 0.2rem 0.5rem; border: 1px solid var(--rule); border-radius: 2px; }
.lang-switch a.active { color: var(--ink); border-color: var(--ink); font-weight: 700; }
main { max-width: 860px; margin: 0 auto; padding: 1.5rem 1rem 4rem; }
h1 { font-size: 2.2rem; font-weight: 700; letter-spacing: -0.01em; line-height: 1.1; margin: 1rem 0 0.5rem; }
h2 { font-size: 1.35rem; font-weight: 700; margin: 2.5rem 0 0.5rem; padding-bottom: 0.4rem; border-bottom: 2px solid var(--ink); }
h3 { font-size: 1.05rem; margin: 1.75rem 0 0.5rem; }
a { color: var(--ink); text-underline-offset: 2px; }
code { font-family: var(--mono); font-size: 0.875em; background: var(--panel); padding: 0.1em 0.35em; border-radius: 2px; }
pre { background: var(--panel); border-left: 4px solid var(--ink); padding: 0.9rem 1rem; overflow-x: auto; }
pre code { background: none; padding: 0; font-size: 0.85rem; }
table { border-collapse: collapse; width: 100%; margin: 1rem 0; font-variant-numeric: tabular-nums; }
th, td { text-align: left; padding: 0.5rem 0.6rem; border-bottom: 1px solid var(--rule); vertical-align: top; }
thead th { background: var(--panel); font-family: var(--mono); font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--ink-soft); }
ul, ol { padding-left: 1.4rem; }
li { margin: 0.25rem 0; }
blockquote { margin: 1rem 0; padding: 0.5rem 1rem; border-left: 4px solid var(--rule); color: var(--ink-soft); }
.footer { border-top: 1px solid var(--rule); color: var(--ink-soft); font-size: 0.8rem; padding: 1rem; text-align: center; }
.app-link { display: inline-block; background: var(--red); color: #fff; text-decoration: none; font-weight: 600; padding: 0.5rem 1.2rem; border-radius: 2px; margin: 0.75rem 0 0; }
@media (max-width: 720px) { h1 { font-size: 1.7rem; } .tabs { gap: 1rem; } }
`;

const shell = (doc, lang, body) => {
  const isIndex = doc.slug === 'index';
  const langHref = (l) => (isIndex ? `../${l}/` : `../${l}/${doc.slug}.html`);
  // enOnly docs (SECURITY.md) have no page in the current language — their
  // nav tab always points at the English page, from either language shell.
  const navHref = (d) => {
    const dLang = d.src[lang] ? lang : 'en';
    if (d.slug === 'index') return dLang === lang ? './' : `../${dLang}/`;
    return dLang === lang ? `${d.slug}.html` : `../${dLang}/${d.slug}.html`;
  };
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${doc.title[lang]}</title>
<style>${css}</style>
</head>
<body>
<header class="topbar">
  <a class="wordmark" href="../../">Schuldrad</a>
  <nav class="tabs" aria-label="Dokumentation">
    ${docs
      .map(
        (d) =>
          `<a href="${navHref(d)}"${d.slug === doc.slug ? ' class="active" aria-current="page"' : ''}>${d.nav[lang]}</a>`,
      )
      .join('\n    ')}
  </nav>
  <div class="lang-switch">
    ${LANGS.filter((l) => l === lang || doc.src[l])
      .map(
        (l) =>
          `<a href="${langHref(l)}"${l === lang ? ' class="active" aria-current="true"' : ''}>${l.toUpperCase()}</a>`,
      )
      .join('\n    ')}
  </div>
</header>
<main>
${isIndex ? '<a class="app-link" href="../../">Schuldrad öffnen / open →</a>' : ''}
${body}
</main>
<footer class="footer">
  Schuldrad – alle Angaben ohne Gewähr, außer den Schuldsprüchen ·
  <a href="https://github.com/mgummich/wheeloffault">Quellcode auf GitHub</a>
</footer>
</body>
</html>
`;
};

await checkCompleteness();

await mkdir(join(outDir, 'en'), { recursive: true });
await mkdir(join(outDir, 'de'), { recursive: true });

for (const lang of LANGS) {
  const marked = markedFor(lang);
  for (const doc of docs) {
    if (!doc.src[lang]) continue; // enOnly doc with no page in this language
    const md = await readFile(join(root, doc.src[lang]), 'utf8');
    const body = marked.parse(md);
    const outName = doc.slug === 'index' ? 'index.html' : `${doc.slug}.html`;
    await writeFile(join(outDir, lang, outName), shell(doc, lang, body));
    console.log(`docs: ${doc.src[lang]} → dist/web/docs/${lang}/${outName}`);
  }
}

// dist/web/docs/index.html (the long-standing /docs/ URL) redirects to the
// English index, keeping the existing external link intact.
await writeFile(
  join(outDir, 'index.html'),
  `<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0; url=en/"><title>Schuldrad · Dokumentation</title><a href="en/">Weiter zur Dokumentation / continue to the docs</a>`,
);
console.log('docs: → dist/web/docs/index.html (redirect to en/)');
