import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';
// @ts-expect-error plain JS helper shared with the build
import { renderLegal, LEGAL_FILES } from './scripts/legal.mjs';

/** Serves /terms and /privacy in dev, and writes them into the build output. */
function legalPages(env: Record<string, string>): Plugin {
  const routes: Record<string, string> = { '/terms': 'terms.html', '/privacy': 'privacy.html', '/legal.css': 'legal.css' };
  return {
    name: 'queueup-legal',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const file = routes[(req.url || '').split('?')[0]];
        if (!file) return next();
        res.setHeader('Content-Type', file.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/html; charset=utf-8');
        res.end(renderLegal(file, env));
      });
    },
    closeBundle() {
      const out = path.resolve(import.meta.dirname, 'client/dist');
      for (const f of LEGAL_FILES) fs.writeFileSync(path.join(out, f), renderLegal(f, env));
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
    publicUrl: (env.PUBLIC_URL || `https://${projectId}.web.app`).replace(/\/$/, ''),
  };

  return {
    root: 'client',
    envDir: import.meta.dirname,
    plugins: [react(), legalPages(env)],
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
