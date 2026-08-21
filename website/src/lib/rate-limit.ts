import { headers } from 'next/headers';
import { sql } from '@vercel/postgres';

async function getClientIp(): Promise<string> {
    const h = await headers();
    const forwarded = h.get('x-forwarded-for');
    if (forwarded) return forwarded.split(',')[0].trim();
    return h.get('x-real-ip') ?? 'unknown';
}

export interface RateLimitResult {
    allowed: boolean;
}

/**
 * A rolling-window rate limit backed by the same Postgres instance as the rest
 * of the app — no new service to provision. Stops a bot (or an impatient
 * human) from flooding the waitlist/alpha-request tables and, more
 * importantly, from flooding NOTIFY_EMAIL with a notification per submission.
 *
 * Fails OPEN (allowed) when POSTGRES_URL isn't configured — the same
 * dev-friendly fallback the rest of the submission flow already uses; in
 * production the caller already refuses to proceed without a database, so
 * this only ever "fails open" during local development.
 */
export async function checkRateLimit(action: string, limit: number, windowMinutes: number): Promise<RateLimitResult> {
    if (!process.env.POSTGRES_URL) return { allowed: true };

    const ip = await getClientIp();
    const windowStart = new Date(Date.now() - windowMinutes * 60_000).toISOString();

    const { rows } = await sql`
        SELECT COUNT(*)::int AS count FROM submission_log
        WHERE ip = ${ip} AND action = ${action} AND created_at > ${windowStart}
    `;
    if ((rows[0]?.count ?? 0) >= limit) {
        return { allowed: false };
    }

    await sql`INSERT INTO submission_log (ip, action) VALUES (${ip}, ${action})`;
    return { allowed: true };
}
