import { readFileSync } from 'node:fs';
import { createContext, Script } from 'node:vm';
import { describe, expect, it } from 'vitest';

describe('service worker caching', () => {
  it('installs the app shell under its deployment scope', async () => {
    const listeners: Record<
      string,
      (event: { waitUntil: (promise: Promise<unknown>) => void }) => void
    > = {};
    let installed: string[] = [];
    const context = createContext({
      self: {
        registration: { scope: 'https://example.com/wheeloffault/' },
        addEventListener: (name: string, listener: (typeof listeners)[string]) => {
          listeners[name] = listener;
        },
        skipWaiting: () => {},
      },
      caches: {
        open: async () => ({
          addAll: async (urls: string[]) => {
            installed = urls;
          },
        }),
      },
      URL,
    });
    new Script(readFileSync(new URL('./public/sw.js', import.meta.url), 'utf8')).runInContext(
      context,
    );
    let installation = Promise.resolve();
    listeners.install?.({
      waitUntil: (promise) => {
        installation = promise.then(() => {});
      },
    });
    await installation;
    expect(installed.map((url) => new URL(url, 'https://example.com').pathname)).toEqual([
      '/wheeloffault/',
      '/wheeloffault/index.html',
      '/wheeloffault/manifest.webmanifest',
      '/wheeloffault/icon.svg',
    ]);
  });

  it('only caches successful basic responses', () => {
    const context = createContext({
      self: {
        addEventListener: () => {},
        registration: { scope: 'https://example.com/wheeloffault/' },
      },
      caches: {},
      URL,
    });

    new Script(readFileSync(new URL('./public/sw.js', import.meta.url), 'utf8')).runInContext(
      context,
    );

    const cacheableResponse = context.cacheableResponse;
    if (typeof cacheableResponse !== 'function') throw new Error('cacheableResponse missing');
    expect(cacheableResponse({ ok: true, type: 'basic' })).toBe(true);
    expect(cacheableResponse({ ok: false, type: 'basic' })).toBe(false);
    expect(cacheableResponse({ ok: true, type: 'opaque' })).toBe(false);
  });
});
