import type { MetadataRoute } from 'next';

// Sitemap entries need an absolute URL. Rather than guess the production
// domain, this returns nothing until NEXT_PUBLIC_SITE_URL is set in Vercel —
// an empty sitemap is harmless; a wrong domain in one is not.
export default function sitemap(): MetadataRoute.Sitemap {
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
    if (!siteUrl) return [];
    return [
        {
            url: siteUrl,
            lastModified: new Date(),
            changeFrequency: 'weekly',
            priority: 1,
        },
    ];
}
