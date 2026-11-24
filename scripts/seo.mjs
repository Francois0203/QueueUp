// robots.txt and sitemap.xml for search engines, built from the site's one public address.
// Party pages (/p, /dj) are private: they're kept out of search (also via a noindex header).

export const PUBLIC_PAGES = ['/', '/terms', '/privacy'];

export const robotsTxt = url => `User-agent: *
Disallow: /p/
Disallow: /dj/
Disallow: /auth/

Sitemap: ${url}/sitemap.xml
`;

export const sitemapXml = url => `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${PUBLIC_PAGES.map(p => `  <url><loc>${url}${p === '/' ? '/' : p}</loc></url>`).join('\n')}
</urlset>
`;
