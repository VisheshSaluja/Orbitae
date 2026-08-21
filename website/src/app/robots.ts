import type { MetadataRoute } from 'next';

// NEXT_PUBLIC_SITE_URL isn't set here yet — omit the sitemap reference rather
// than point at a guessed domain. Add it once the production URL is set.
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;

export default function robots(): MetadataRoute.Robots {
    return {
        rules: {
            userAgent: '*',
            allow: '/',
        },
        ...(siteUrl ? { sitemap: `${siteUrl}/sitemap.xml` } : {}),
    };
}
