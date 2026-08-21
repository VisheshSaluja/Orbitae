'use server';

import { z } from 'zod';
import { sql } from '@vercel/postgres';
import { sendMail } from '../lib/mail';
import { checkRateLimit } from '../lib/rate-limit';

// A hidden field real visitors never see or fill; bots that auto-fill every
// input do. A filled honeypot pretends success and does nothing further —
// tipping off the bot that it was caught just teaches it to adapt.
const HONEYPOT_FIELD = 'company_website';

// Schema for Waitlist
const WaitlistSchema = z.object({
    email: z.string().email(),
});

// Schema for Alpha Request
const AlphaRequestSchema = z.object({
    name: z.string().min(2, "Name is required"),
    email: z.string().email("Invalid email address"),
    role: z.string().min(2, "Role is required"),
    company: z.string().optional(),
    socialUrl: z.string().url("Must be a valid URL (GitHub/Twitter/LinkedIn)"),
    reason: z.string().min(10, "Please tell us a bit more about why you want access"),
    agreeToNDA: z.boolean().refine(val => val === true, "You must agree to the NDA"),
});

export type WaitlistState = {
    success?: boolean;
    error?: string;
    message?: string;
};

export type AlphaRequestState = {
    success?: boolean;
    errors?: Record<string, string[]>;
    message?: string;
};

export async function submitWaitlist(prevState: WaitlistState, formData: FormData): Promise<WaitlistState> {
    if (formData.get(HONEYPOT_FIELD)) {
        return { success: true, message: 'Added to the waitlist!' };
    }

    const email = formData.get('email');
    const result = WaitlistSchema.safeParse({ email });

    if (!result.success) {
        return { success: false, error: 'Invalid email address' };
    }

    const rl = await checkRateLimit('waitlist', 5, 60); // 5 per hour per IP
    if (!rl.allowed) {
        return { success: false, error: 'Too many attempts. Please try again in a bit.' };
    }

    if (process.env.POSTGRES_URL) {
        try {
            await sql`INSERT INTO waitlist (email) VALUES (${result.data.email}) ON CONFLICT DO NOTHING`;
        } catch (error) {
            console.error('Database Error:', error);
            return { success: false, error: 'Failed to save subscription.' };
        }
    } else if (process.env.NODE_ENV === 'development') {
        console.log('[DEV] Waitlist submission (no DB configured):', result.data.email);
    } else {
        // Production with no database configured is a real misconfiguration —
        // never report success for a signup that was never stored.
        console.error('[submitWaitlist] POSTGRES_URL is not configured');
        return { success: false, error: 'Signup is temporarily unavailable. Please try again shortly.' };
    }

    await sendMail({
        to: result.data.email,
        subject: "You're on the Orbitae waitlist",
        text: "Thanks for your interest in Orbitae! We'll email you as soon as alpha access opens up.\n\n— The Orbitae team",
    });
    if (process.env.NOTIFY_EMAIL) {
        await sendMail({
            to: process.env.NOTIFY_EMAIL,
            subject: 'New Orbitae waitlist signup',
            text: `New waitlist signup: ${result.data.email}`,
        });
    }

    return { success: true, message: 'Added to the waitlist!' };
}

export async function submitAlphaRequest(prevState: AlphaRequestState, formData: FormData): Promise<AlphaRequestState> {
    if (formData.get(HONEYPOT_FIELD)) {
        return { success: true, message: 'Request received. We will contact you soon.' };
    }

    const data = {
        name: formData.get('name'),
        email: formData.get('email'),
        role: formData.get('role'),
        company: formData.get('company'),
        socialUrl: formData.get('socialUrl'),
        reason: formData.get('reason'),
        agreeToNDA: formData.get('agreeToNDA') === 'on',
    };

    const result = AlphaRequestSchema.safeParse(data);

    if (!result.success) {
        return {
            success: false,
            errors: result.error.flatten().fieldErrors,
            message: 'Please fix the errors below.',
        };
    }

    const rl = await checkRateLimit('alpha_request', 3, 24 * 60); // 3 per day per IP
    if (!rl.allowed) {
        return { success: false, message: 'Too many requests from this network. Please try again tomorrow.' };
    }

    if (process.env.POSTGRES_URL) {
        try {
            await sql`
                INSERT INTO alpha_requests (name, email, role, company, social_url, reason, agreed_nda)
                VALUES (
                    ${result.data.name},
                    ${result.data.email},
                    ${result.data.role},
                    ${result.data.company || ''},
                    ${result.data.socialUrl},
                    ${result.data.reason},
                    ${result.data.agreeToNDA}
                )
            `;
        } catch (error) {
            console.error('Database Error:', error);
            return { success: false, message: 'Failed to submit request. Please try again.' };
        }
    } else if (process.env.NODE_ENV === 'development') {
        console.log('[DEV] Alpha Request (no DB configured):', result.data);
    } else {
        console.error('[submitAlphaRequest] POSTGRES_URL is not configured');
        return { success: false, message: 'Signup is temporarily unavailable. Please try again shortly.' };
    }

    await sendMail({
        to: result.data.email,
        subject: 'Your Orbitae alpha access request',
        text: "Thanks for requesting alpha access to Orbitae! We're reviewing requests on a rolling basis and will reach out soon.\n\n— The Orbitae team",
    });
    if (process.env.NOTIFY_EMAIL) {
        await sendMail({
            to: process.env.NOTIFY_EMAIL,
            subject: 'New Orbitae alpha access request',
            text: [
                `Name: ${result.data.name}`,
                `Email: ${result.data.email}`,
                `Role: ${result.data.role}`,
                `Company: ${result.data.company || '—'}`,
                `Social: ${result.data.socialUrl}`,
                '',
                'Reason:',
                result.data.reason,
            ].join('\n'),
        });
    }

    return { success: true, message: 'Request received. We will contact you soon.' };
}
