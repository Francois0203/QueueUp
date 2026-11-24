import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';
// @ts-expect-error plain JS helper shared with the build
import { renderLegal, LEGAL_FILES, publicUrl } from './scripts/legal.mjs';
// @ts-expect-error plain JS helper shared with the build
import { robotsTxt, sitemapXml } from './scripts/seo.mjs';

/**
 * Static pages built from templates: Terms, Privacy, robots.txt and sitemap.xml. Served in dev and
 * written into the build. Also tags the app page with its canonical address for search engines.
 */
function staticPages(env: Record<string, string>): Plugin {
  const url: string = publicUrl(env);
  const files: Record<string, () => string> = {
    ...Object.fromEntries((LEGAL_FILES as string[]).map(f => [f, () => renderLegal(f, env)])),
    'robots.txt': () => robotsTxt(url),
    'sitemap.xml': () => sitemapXml(url),
  };
  const routes: Record<string, string> = {
    '/terms': 'terms.html', '/privacy': 'privacy.html', '/legal.css': 'legal.css', '/robots.txt': 'robots.txt', '/sitemap.xml': 'sitemap.xml',
  };
  const types: Record<string, string> = { html: 'text/html', css: 'text/css', txt: 'text/plain', xml: 'application/xml' };
  return {
    name: 'queueup-static-pages',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const file = routes[(req.url || '').split('?')[0]];
        if (!file) return next();
        res.setHeader('Content-Type', `${types[file.split('.').pop()!]}; charset=utf-8`);
        res.end(files[file]());
      });
    },
    transformIndexHtml: () => [{ tag: 'link', attrs: { rel: 'canonical', href: `${url}/` }, injectTo: 'head' }],
    closeBundle() {
      const out = path.resolve(import.meta.dirname, 'client/dist');
      for (const [f, render] of Object.entries(files)) fs.writeFileSync(path.join(out, f), render());
    },
  };
}

export default defineConfig(({ mode }) => {
  // Reads .env files from the project root plus the real environment (GitHub Actions secrets).
  const env = { ...loadEnv(mode, import.meta.dirname, ''), ...process.env } as Record<string, string>;
  const emulators = env.USE_EMULATORS === 'true';
  const projectId = env.FIREBASE_PROJECT_ID || 'demo-queueup';

  // Only these values reach the browser (the Firebase web config is public by design).
  const firebase = {
    config: {
      apiKey: env.FIREBASE_API_KEY || 'demo-api-key',
      authDomain: env.FIREBASE_AUTH_DOMAIN || `${projectId}.firebaseapp.com`,
      projectId,
      appId: env.FIREBASE_APP_ID || undefined,
    },
    emulators,
    appCheckKey: env.FIREBASE_APPCHECK_SITE_KEY || '',
    publicUrl: publicUrl(env),
  };

  return {
    root: 'client',
    envDir: import.meta.dirname,
    plugins: [react(), staticPages(env)],
    define: { __FIREBASE__: JSON.stringify(firebase) },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      sourcemap: false,
      assetsInlineLimit: 0, // everything self-hosted as files (keeps the CSP strict)
    },
    server: {
      host: 'localhost',
      port: 3000,
      strictPort: true,
    },
  };
});
