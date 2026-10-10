import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../../config/env.js';
import type { EmailMessage, EmailProvider } from './types.js';

// Sends through a Gmail account (SMTP, app password). Meant for early stages; swap for a transactional provider later.
export class GmailEmail implements EmailProvider {
  private readonly transporter: Transporter;

  constructor() {
    const { user, pass } = env.email.gmail;
    if (!user || !pass) throw new Error('GMAIL_USER and GMAIL_PASS are required when EMAIL_DRIVER=gmail');
    this.transporter = nodemailer.createTransport({ service: 'gmail', auth: { user, pass } });
  }

  async send({ to, subject, text }: EmailMessage): Promise<void> {
    await this.transporter.sendMail({ from: `Nivaas <${env.email.gmail.user}>`, to, subject, text });
  }
}
