// Renders the legal pages (Terms, Privacy) from legal/*.html with the operator's details.
// Used by the Vite dev server and written into client/dist at build time, so they are plain
// static pages on Firebase Hosting that work without JavaScript.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const TERMS_VERSION = '2026-11-24';

const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** The one address the site is served from (others redirect here). */
export const publicUrl = (env = process.env) =>
  (env.PUBLIC_URL || `https://${env.FIREBASE_PROJECT_ID || 'demo-queueup'}.web.app`).replace(/\/$/, '');

export function operatorDetails(env = process.env) {
  return {
    OPERATOR_NAME: env.OPERATOR_NAME || '[Operator name]',
    OPERATOR_CONTACT: env.OPERATOR_CONTACT || '[contact email]',
    OPERATOR_ADDRESS: env.OPERATOR_ADDRESS || '[postal address]',
    GOVERNING_LAW: env.GOVERNING_LAW || '[country]',
    HOSTING_PROVIDER: env.HOSTING_PROVIDER || 'Google Firebase (Google Cloud, europe-west1)',
    PUBLIC_URL: publicUrl(env),
    TERMS_VERSION,
  };
}

export function renderLegal(file, env = process.env) {
  const vars = operatorDetails(env);
  const html = fs.readFileSync(path.join(ROOT, 'legal', file), 'utf8');
  return html.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in vars ? escapeHtml(vars[k]) : m));
}

export const LEGAL_FILES = ['terms.html', 'privacy.html', 'legal.css'];
