import nodemailer from 'nodemailer';
import { config } from '../config.js';

function createTransport() {
  if (!config.SMTP_HOST) return null;
  return nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: config.SMTP_PORT === 465,
    auth: config.SMTP_USER
      ? { user: config.SMTP_USER, pass: config.SMTP_PASS }
      : undefined,
    connectionTimeout: 5000,
    greetingTimeout: 5000,
    socketTimeout: 5000,
  });
}

export async function sendPasswordResetEmail(to: string, resetUrl: string): Promise<void> {
  const transport = createTransport();

  const html = `
    <p>You have been sent a password reset link for your AI Gateway account.</p>
    <p><a href="${resetUrl}" style="background:#4f46e5;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;display:inline-block;margin:12px 0">Reset password</a></p>
    <p>Or copy this link into your browser:<br><code>${resetUrl}</code></p>
    <p>This link expires in <strong>1 hour</strong>. If you did not request a password reset, ignore this email.</p>
  `;

  if (!transport) {
    // No SMTP configured — print to console (useful in development)
    console.log(`\n[PASSWORD RESET] To: ${to}\nLink: ${resetUrl}\n`);
    return;
  }

  await transport.sendMail({
    from: config.SMTP_FROM,
    to,
    subject: 'Reset your AI Gateway password',
    html,
  });
}
