import nodemailer from 'nodemailer';

/**
 * Outgoing email via SMTP through an account you own — no third-party
 * transactional-email service. Configured entirely through environment
 * variables (set in Vercel, never committed):
 *
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS  — required
 *   MAIL_FROM     — sender address (defaults to SMTP_USER)
 *   NOTIFY_EMAIL  — where founder notifications are sent
 *
 * Email is a best-effort side effect, never the source of truth for whether a
 * submission succeeded — the database write is. A send failure is logged and
 * swallowed so it can never turn a successful signup into an error response.
 */

let transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter | null {
    const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
    if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) return null;
    if (!transporter) {
        const port = Number(SMTP_PORT ?? 587);
        transporter = nodemailer.createTransport({
            host: SMTP_HOST,
            port,
            secure: port === 465,
            auth: { user: SMTP_USER, pass: SMTP_PASS },
        });
    }
    return transporter;
}

export async function sendMail(opts: { to: string; subject: string; text: string }): Promise<void> {
    const t = getTransporter();
    if (!t) {
        console.log('[mail] SMTP not configured, skipping send:', opts.subject, '→', opts.to);
        return;
    }
    try {
        await t.sendMail({
            from: process.env.MAIL_FROM || process.env.SMTP_USER,
            to: opts.to,
            subject: opts.subject,
            text: opts.text,
        });
    } catch (err) {
        console.error('[mail] send failed:', err);
    }
}
