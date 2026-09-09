// Renders README.md/README.de.md and docs/en, docs/de as styled HTML into
// dist/web/docs/, so GitHub Pages serves the documentation next to the app.
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
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
    // ponytail: known ceiling — enOnly is an unguarded opt-out; nothing here
    // tells a deliberate English-only doc apart from a translation that
    // simply drifted out of the registry.
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
      // Markdown docs only: this check is about doc-pair completeness, not
      // a general directory audit. Non-.md files (e.g. a stray asset) and
      // anything outside docs/en or docs/de (e.g. docs/STATUS.json, a
      // verification record with no rendered page) are out of its scope.
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

// SYMBOL GUARD: a backticked identifier that looks like a code symbol —
// call syntax (`foo()`, `spinHistory(state)`) or an ALL_CAPS_CONSTANT — must
// actually be exported somewhere in src/ (ALL_CAPS names may also be an env
// var read via `env.NAME`/`process.env.NAME`, since those never appear as a
// JS export). Catches a doc still claiming an API that was renamed or
// un-exported out from under it — e.g. `spinHistory(state)` listed as a
// projection API after it went module-private.
//
// Deliberately does NOT check bare identifiers without call syntax
// (`someExport`, no parens): those collide constantly with plain object/prop
// names in prose (`memberId`, `onFinished`, `packageManager`, ...), which
// would make the ignore list unmanageable. Call syntax and ALL_CAPS
// constants are the two shapes that stayed unambiguous in practice.
const SYMBOL_IGNORE = new Set([
  'append', // `EventStore.append` is an interface method, not a bare export
  'decide', // ARCHITECTURE.md's diagram name for the whole family of
  // decision functions (addMembers, commitSpin, revealSpin, ...), not one
  // literal function called `decide`
  'uint64', // pseudocode in the fairness formula's ASCII diagram, not a
  // real identifier anywhere in the codebase
  'events', // "`events(stream_id, version)` is `UNIQUE`" names SQL table
  // columns, not a JS function call
  'finish', // each animation stage has its own local finish(), not one
  // shared export named `finish`
  'onFinished', // a prop name (`props.onFinished`), not an exported symbol
  'nameOf', // a local const inside SpinDetailPage, not a shared export
  'SHA256', // pseudocode for the hash step; the code calls Web Crypto with
  // the string 'SHA-256', there is no identifier `SHA256`
]);

async function buildKnownSymbols() {
  const names = new Set();
  for (const file of await listFiles(join(root, 'src'))) {
    if (!/\.(ts|tsx)$/.test(file)) continue;
    const text = await readFile(file, 'utf8');
    for (const m of text.matchAll(
      /\bexport\s+(?:default\s+)?(?:async\s+)?(?:function\*?|const|class|type|interface|enum)\s+([A-Za-z_$][\w$]*)/g,
    )) {
      names.add(m[1]);
    }
    for (const m of text.matchAll(/\benv\.([A-Z][A-Z0-9_]*)/g)) names.add(m[1]);
    for (const m of text.matchAll(/\bprocess\.env\.([A-Z][A-Z0-9_]*)/g)) names.add(m[1]);
  }
  return names;
}

const SYMBOL_CALL_RE = /^([A-Za-z_$][\w$]*)\(([^()]*)\)$/;
const SYMBOL_CONST_RE = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/;

// A symbol can be named two ways in these docs: an inline `span` (single
// backticks), or a line inside a fenced ``` block — ARCHITECTURE.md's
// projections/HTTP-contract listings are written as fenced blocks, not
// inline spans, so both need scanning.
function symbolCandidates(md) {
  const out = [];
  const fenceRe = /```[^\n]*\n([\s\S]*?)```/g;
  for (const m of md.matchAll(fenceRe)) {
    for (const c of m[1].matchAll(/\b[A-Za-z_$][\w$]*\([^()\n]{0,80}\)/g)) out.push(c[0]);
    for (const c of m[1].matchAll(/\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g)) out.push(c[0]);
  }
  for (const m of md.replace(fenceRe, '').matchAll(/`([^`\n]+)`/g)) out.push(m[1]);
  return out;
}

async function checkSymbolGuard() {
  const known = await buildKnownSymbols();
  const problems = [];
  for (const doc of docs) {
    for (const lang of LANGS) {
      if (!doc.src[lang]) continue;
      const md = await readFile(join(root, doc.src[lang]), 'utf8');
      for (const raw of symbolCandidates(md)) {
        const call = SYMBOL_CALL_RE.exec(raw);
        const name = call ? call[1] : SYMBOL_CONST_RE.test(raw) ? raw : null;
        if (!name || SYMBOL_IGNORE.has(name) || known.has(name)) continue;
        problems.push(
          `${doc.src[lang]}: \`${raw}\` names "${name}", which is not exported anywhere in src/ (renamed, un-exported, or a typo?).`,
        );
      }
    }
  }
  if (problems.length > 0) {
    console.error('docs: symbol guard failed — a doc names a symbol the code does not export:');
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
}

// ponytail: known ceiling — two headings that slug() to the same id collide
// silently (last one wins in the id set, anchors bind to the first heading
// in the DOM); not deduped, upgrade to a counter suffix if it ever bites.
const slug = (text) =>
  text
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[^a-z0-9äöüß\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');

// Cross-links inside the Markdown source (README.md, docs/en/*.md, ...) are
// rewritten to point at the rendered page of whichever language the link's
// target file actually is, so "Deutsch → architektur.md" and "English →
// ARCHITECTURE.md" cross over instead of self-linking. checkContentLanguage()
// below verifies this independently, after the build.

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
        // A trailing #en/#de is a language marker, not a real anchor: some
        // links can't carry a directory/filename marker (e.g. README.de.md
        // linking to sibling README.md) so they mark language this way
        // instead. Any other fragment (a real deep link into another doc's
        // section) is kept on the rendered href, just not marker-stripped.
        const hashIdx = href.indexOf('#');
        const hrefPath = hashIdx === -1 ? href : href.slice(0, hashIdx);
        const frag = hashIdx === -1 ? null : href.slice(hashIdx + 1);
        const hrefBase = hrefPath.split('/').pop();
        const target = docs.find(
          (d) => d.src.en.split('/').pop() === hrefBase || d.src.de?.split('/').pop() === hrefBase,
        );
        if (target) {
          // The href's own language marker wins: a directory segment
          // (../de/, docs/de/, ../en/, docs/en/), a filename marker
          // (README.de.md), or a #en/#de fragment marker. A bare basename
          // shared by both languages (deployment.md, fairness.md, ...)
          // carries no marker, so it falls back to the CURRENT page's
          // language — keeping in-page links in-language instead of
          // defaulting to `en`.
          const fragMarker = frag === 'en' || frag === 'de' ? frag : null;
          const dirMarker = /(^|\/)de\//.test(hrefPath)
            ? 'de'
            : /(^|\/)en\//.test(hrefPath)
              ? 'en'
              : null;
          const fileMarker = /\.de\.md$/.test(hrefBase) ? 'de' : null;
          // ponytail: this marker logic is hand-duplicated in expectedTarget()
          // below (deliberately — see that function's comment) — keep both in sync.
          const wantLang = fragMarker || dirMarker || fileMarker || lang;
          const targetLang = target.src[wantLang] ? wantLang : 'en';
          const path =
            target.slug === 'index' ? `${targetLang}/` : `${targetLang}/${target.slug}.html`;
          const keepFrag = frag && !fragMarker ? `#${frag}` : '';
          return `<a href="../${path}${keepFrag}">${text}</a>`;
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
  // enOnly docs (SECURITY.md) have no page in the other language — route
  // that language's switch link to its docs index instead of a page that
  // was never rendered, so a reader isn't stranded with no way back.
  const langHref = (l) => (isIndex || !doc.src[l] ? `../${l}/` : `../${l}/${doc.slug}.html`);
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
    ${LANGS.map(
      (l) =>
        `<a href="${langHref(l)}"${l === lang ? ' class="active" aria-current="true"' : ''}>${l.toUpperCase()}</a>`,
    ).join('\n    ')}
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
await checkSymbolGuard();

await mkdir(join(outDir, 'en'), { recursive: true });
await mkdir(join(outDir, 'de'), { recursive: true });

// checkContentLanguage() below asserts against these exact rendered bodies
// (the markedFor() output, before shell() wraps it in nav/lang-switch
// markup) — so a shell-only bug can't accidentally satisfy a body check.
const renderedBodies = new Map(); // `${lang}/${slug}` -> body HTML

for (const lang of LANGS) {
  const marked = markedFor(lang);
  for (const doc of docs) {
    if (!doc.src[lang]) continue; // enOnly doc with no page in this language
    const md = await readFile(join(root, doc.src[lang]), 'utf8');
    const body = marked.parse(md);
    renderedBodies.set(`${lang}/${doc.slug}`, body);
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

// Get links from marked's own lexer (one source of truth: code fences,
// reference-style links and nested tokens — list items, table cells,
// blockquotes — behave exactly as they do in the rendered output, unlike a
// hand-rolled regex).
const lexerOnly = new Marked({ gfm: true });
// ponytail: known ceiling — images are entirely unvalidated (no renderer
// override, so no image() rewriting or dist copy step; collectLinks() only
// visits type === 'link' nodes, not 'image'; checkArtifactLinks() below
// only scans <a href>, not <img src>). No docs source embeds an image
// today, so this is inert; if one ever does, extend collectLinks() to also
// visit type === 'image' and add an image() renderer override that copies
// the file into dist and rewrites its src, same as link() does for hrefs.
function collectLinks(md) {
  const hrefs = [];
  const visit = (node) => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!node || typeof node !== 'object') return;
    if (node.type === 'link') hrefs.push(node.href);
    for (const v of Object.values(node)) visit(v);
  };
  visit(lexerOnly.lexer(md));
  return hrefs;
}

// Independent of markedFor()'s link() renderer — deliberately not shared
// with it. This is the test oracle: if it called the same code as
// production, a bug in that code would pass its own check.
// ponytail: the marker logic below duplicates markedFor()'s link() by hand —
// deliberate, so the check stays independent of the resolver it's checking.
function expectedTarget(hrefPath, frag, pageLang) {
  const hrefBase = hrefPath.split('/').pop();
  const target = docs.find(
    (d) => d.src.en.split('/').pop() === hrefBase || d.src.de?.split('/').pop() === hrefBase,
  );
  if (!target) return null;
  const marker =
    frag === 'en' || frag === 'de'
      ? frag
      : /(^|\/)de\//.test(hrefPath) || /\.de\.md$/.test(hrefBase)
        ? 'de'
        : /(^|\/)en\//.test(hrefPath)
          ? 'en'
          : null;
  const lang = target.src[marker || pageLang] ? marker || pageLang : 'en';
  return { target, marker, lang };
}

// One language-correctness assertion, per doc link in the source: the
// rendered body must actually contain the href the marker says it should
// (catches a broken/disabled marker or fallback in the renderer), and a
// link to a doc's OWN counterpart page must carry that language's marker
// rather than silently falling back to whichever language the marker-less
// default happens to produce (the pairing is a property of the doc, not of
// the href being checked — so this isn't tautological).
async function checkContentLanguage() {
  const problems = [];
  for (const lang of LANGS) {
    const otherLang = lang === 'en' ? 'de' : 'en';
    for (const doc of docs) {
      if (!doc.src[lang]) continue;
      const md = await readFile(join(root, doc.src[lang]), 'utf8');
      const body = renderedBodies.get(`${lang}/${doc.slug}`) ?? '';

      for (const href of collectLinks(md)) {
        const hashIdx = href.indexOf('#');
        const hrefPath = hashIdx === -1 ? href : href.slice(0, hashIdx);
        if (!hrefPath.endsWith('.md')) continue; // not a doc-to-doc link
        const frag = hashIdx === -1 ? null : href.slice(hashIdx + 1);
        const info = expectedTarget(hrefPath, frag, lang);
        if (!info) continue; // unregistered target; checkArtifactLinks() catches dead links

        // expectedTarget() resolves by basename only; that's fine for what
        // it checks, but a literal relative href with the right basename
        // and the wrong directory (e.g. "deployment.md" from the repo
        // root, where the real file lives at docs/en/deployment.md) would
        // pass that match and still 404 on GitHub, which renders the
        // literal markdown link. Confirm the href actually resolves from
        // its source file's own directory.
        try {
          await stat(join(root, dirname(doc.src[lang]), hrefPath));
        } catch {
          problems.push(
            `${doc.src[lang]}: link "${href}" does not resolve to a file at that relative path (GitHub would 404 on it).`,
          );
        }

        const expectedHref =
          '../' +
          (info.target.slug === 'index'
            ? `${info.lang}/`
            : `${info.lang}/${info.target.slug}.html`);
        // Match either the bare href or the href plus a kept cross-doc
        // fragment (keepFrag) that this check doesn't otherwise compute —
        // but always require a closing quote or a '#' right after
        // expectedHref, so an index target's href (e.g. "../de/") can't
        // prefix-match every other same-language href on the page.
        if (!body.includes(`href="${expectedHref}"`) && !body.includes(`href="${expectedHref}#`)) {
          problems.push(
            `${doc.src[lang]}: link "${href}" should render as ${expectedHref}, but the rendered page doesn't.`,
          );
        }

        // Not just a doc's OWN counterpart: any raw-markdown link whose
        // basename is the OTHER language's file for its target, while that
        // target also has a same-language file for THIS page, opens the
        // wrong-language page on GitHub (the site's fallback masks it, but
        // GitHub renders the literal href) — unless a marker says so on
        // purpose.
        const hrefBase = hrefPath.split('/').pop();
        const pageLangBase = info.target.src[lang]?.split('/').pop();
        const otherLangBase = info.target.src[otherLang]?.split('/').pop();
        if (
          pageLangBase &&
          hrefBase !== pageLangBase &&
          hrefBase === otherLangBase &&
          info.marker !== otherLang
        ) {
          problems.push(
            `${doc.src[lang]}: link "${href}" points at the ${otherLang} file ${hrefBase}, but this is a ${lang} page and '${info.target.slug}' has a ${lang} counterpart (${pageLangBase}); link to it directly or add an explicit ${otherLang} marker.`,
          );
        }
      }
    }
  }
  if (problems.length > 0) {
    console.error('docs: content link-language check failed:');
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
}

async function listFiles(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    out.push(...(entry.isDirectory() ? await listFiles(full) : [full]));
  }
  return out;
}

// Validate the FINAL WRITTEN OUTPUT: one pass over every generated HTML
// file's href="..." — shell (wordmark, nav, language switch) and body
// alike — asserting each internal href resolves to a file that was
// actually written, and each in-page #anchor to a heading id that was
// actually generated. This is what catches a broken nav/lang-switch href
// without knowing anything about how it was built.
async function checkArtifactLinks() {
  const problems = [];
  const written = new Set(await listFiles(join(root, 'dist', 'web')));
  const docFiles = (await listFiles(outDir)).filter((f) => f.endsWith('.html'));

  // Heading ids per doc file, gathered up front so a cross-doc fragment link
  // can be checked against its TARGET file's ids regardless of visit order.
  const idsByFile = new Map();
  for (const file of docFiles) {
    const html = await readFile(file, 'utf8');
    idsByFile.set(
      file,
      new Set(Array.from(html.matchAll(/<h[1-6][^>]*\sid="([^"]+)"/g), (m) => m[1])),
    );
  }

  for (const file of docFiles) {
    const ids = idsByFile.get(file);
    const html = await readFile(file, 'utf8');
    for (const [, href] of html.matchAll(/<a\s[^>]*\bhref="([^"]*)"/g)) {
      if (/^(https?:)?\/\//.test(href) || href.startsWith('mailto:')) continue;
      if (href.startsWith('#')) {
        if (!ids.has(href.slice(1))) {
          problems.push(`${file}: anchor "${href}" has no matching heading id.`);
        }
        continue;
      }
      const hashIdx = href.indexOf('#');
      const hrefPath = hashIdx === -1 ? href : href.slice(0, hashIdx);
      const frag = hashIdx === -1 ? null : href.slice(hashIdx + 1);
      let resolved = join(dirname(file), hrefPath);
      if (hrefPath.endsWith('/')) resolved = join(resolved, 'index.html');
      if (!written.has(resolved)) {
        problems.push(`${file}: href "${href}" resolves to a file that was never written.`);
      } else if (frag && idsByFile.has(resolved) && !idsByFile.get(resolved).has(frag)) {
        problems.push(
          `${file}: href "${href}" points at a heading id "${frag}" that doesn't exist in ${resolved}.`,
        );
      }
    }
  }
  if (problems.length > 0) {
    console.error('docs: artifact link check failed:');
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
}

await checkContentLanguage();
await checkArtifactLinks();
