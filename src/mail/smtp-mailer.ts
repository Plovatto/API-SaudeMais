import nodemailer, { type Transporter } from 'nodemailer';
import type { MailMessage, Mailer } from './mailer.js';

export interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
}

export function createSmtpTransport({ host, port, user, pass }: SmtpConfig): Transporter {
  return nodemailer.createTransport({ host, port, secure: port === 465, auth: { user, pass } });
}

export class SmtpMailer implements Mailer {
  constructor(
    private readonly transporter: Transporter,
    private readonly from: string,
  ) {}

  async send({ to, subject, html, text }: MailMessage): Promise<void> {
    await this.transporter.sendMail({ from: this.from, to, subject, html, text });
  }
}
