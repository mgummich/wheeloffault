// Renders README.md and ARCHITECTURE.md as styled HTML into dist/web/docs/,
// so GitHub Pages serves the documentation next to the app.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Marked } from 'marked';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'dist', 'web', 'docs');

const pages = [
  { src: 'README.md', out: 'index.html', title: 'Schuldrad · Dokumentation', nav: 'Start' },
  {
    src: 'ARCHITECTURE.md',
    out: 'architektur.html',
    title: 'Schuldrad · Architektur',
    nav: 'Architektur',
  },
];

const slug = (text) =>
  text
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[^a-z0-9äöüß\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');

const marked = new Marked({
  gfm: true,
  renderer: {
    heading({ tokens, depth }) {
      const text = this.parser.parseInline(tokens);
      return `<h${depth} id="${slug(text)}">${text}</h${depth}>\n`;
    },
    // Cross-links between the two Markdown files become links between the pages.
    link({ href, tokens }) {
      const text = this.parser.parseInline(tokens);
      const target =
        href === 'ARCHITECTURE.md' ? 'architektur.html' : href === 'README.md' ? './' : href;
      return `<a href="${target}">${text}</a>`;
    },
  },
});

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
.tabs { display: flex; gap: 1.5rem; height: 56px; }
.tabs a { display: flex; align-items: center; text-decoration: none; color: var(--ink-soft); border-bottom: 3px solid transparent; font-weight: 600; }
.tabs a.active { color: var(--ink); border-bottom-color: var(--red); }
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

const shell = (page, body) => `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${page.title}</title>
<style>${css}</style>
</head>
<body>
<header class="topbar">
  <a class="wordmark" href="../">Schuldrad</a>
  <nav class="tabs" aria-label="Dokumentation">
    <a href="./"${page.out === 'index.html' ? ' class="active" aria-current="page"' : ''}>Doku</a>
    <a href="architektur.html"${page.out === 'architektur.html' ? ' class="active" aria-current="page"' : ''}>Architektur</a>
    <a href="../">Zur App</a>
  </nav>
</header>
<main>
${page.out === 'index.html' ? '<a class="app-link" href="../">Schuldrad öffnen →</a>' : ''}
${body}
</main>
<footer class="footer">
  Schuldrad – alle Angaben ohne Gewähr, außer den Schuldsprüchen ·
  <a href="https://github.com/mgummich/wheeloffault">Quellcode auf GitHub</a>
</footer>
</body>
</html>
`;

await mkdir(outDir, { recursive: true });
for (const page of pages) {
  const md = await readFile(join(root, page.src), 'utf8');
  const body = marked.parse(md);
  await writeFile(join(outDir, page.out), shell(page, body));
  console.log(`docs: ${page.src} → dist/web/docs/${page.out}`);
}
