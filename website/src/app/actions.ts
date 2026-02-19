'use server';

import { z } from 'zod';
import { sql } from '@vercel/postgres';

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
    const email = formData.get('email');

    const result = WaitlistSchema.safeParse({ email });

    if (!result.success) {
        return { success: false, error: 'Invalid email address' };
    }

    try {
        // Only attempt DB write if configured
        if (process.env.POSTGRES_URL) {
            await sql`INSERT INTO waitlist (email) VALUES (${result.data.email}) ON CONFLICT DO NOTHING`;
        } else {
            console.log('[DEV] Waitlist submission (no DB configured):', result.data.email);
        }
    } catch (error) {
        console.error('Database Error:', error);
        return { success: false, error: 'Failed to save subscription.' };
    }

    return { success: true, message: 'Added to the waitlist!' };
}

export async function submitAlphaRequest(prevState: AlphaRequestState, formData: FormData): Promise<AlphaRequestState> {
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

    try {
        if (process.env.POSTGRES_URL) {
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
        } else {
            if (process.env.NODE_ENV === 'development') {
                console.log('[DEV] Alpha Request (no DB configured):', result.data);
            }
        }
    } catch (error) {
        console.error('Database Error:', error);
        return { success: false, message: 'Failed to submit request. Please try again.' };
    }

    return { success: true, message: 'Request received. We will contact you soon.' };
}
