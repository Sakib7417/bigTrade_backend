import crypto from 'crypto';
import nodemailer from 'nodemailer';
import config from '../config/env.js';
import logger from '../config/logger.js';

let transporter = null;

// Brevo SMTP relay — used when the key is an SMTP key (xsmtpsib-…)
function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.BREVO_SMTP_HOST || 'smtp-relay.brevo.com',
      port: parseInt(process.env.BREVO_SMTP_PORT, 10) || 587,
      secure: false,
      auth: {
        user: process.env.BREVO_SMTP_USER || config.brevo.senderEmail,
        pass: config.brevo.apiKey,
      },
    });
  }
  return transporter;
}

async function sendEmail({ to, subject, html }) {
  if (!config.brevo.apiKey) {
    logger.warn('BREVO_API_KEY not configured — email skipped');
    return false;
  }

  // xsmtpsib- keys are SMTP credentials → use the relay, not the REST API
  if (config.brevo.apiKey.startsWith('xsmtpsib-')) {
    try {
      await getTransporter().sendMail({
        from: `"${config.brevo.senderName}" <${config.brevo.senderEmail}>`,
        to,
        subject,
        html,
      });
      return true;
    } catch (err) {
      logger.error(`Brevo SMTP send failed: ${err.message}`);
      return false;
    }
  }

  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': config.brevo.apiKey,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      sender: { name: config.brevo.senderName, email: config.brevo.senderEmail },
      to: [{ email: to }],
      subject,
      htmlContent: html,
    }),
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    logger.error(`Brevo send failed (${res.status}): ${body}`);
    return false;
  }
  return true;
}

export const generateOtp = () => String(crypto.randomInt(100000, 1000000));

export const hashOtp = (code) => crypto.createHash('sha256').update(code).digest('hex');

export async function sendOtpEmail(email, code, name = '', purpose = 'REGISTER') {
  const isReset = purpose === 'RESET';
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:24px;border:1px solid #e5e7eb;border-radius:12px">
      <h2 style="color:#1255FF;margin:0 0 8px">${config.brevo.senderName}</h2>
      <p style="color:#374151">Hi${name ? ` ${name}` : ''},</p>
      <p style="color:#374151">Your ${isReset ? 'password reset' : 'email verification'} code is:</p>
      <p style="font-size:32px;font-weight:bold;letter-spacing:6px;color:#111827;text-align:center;margin:24px 0">${code}</p>
      <p style="color:#6b7280;font-size:13px">This code expires in ${config.brevo.otpMinutes} minutes. If you didn't request it, ignore this email.</p>
    </div>`;
  const subject = isReset
    ? `${code} is your password reset code`
    : `${code} is your verification code`;
  return sendEmail({ to: email, subject, html });
}
