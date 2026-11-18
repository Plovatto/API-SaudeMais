import type { MailMessage } from './mailer.js';

interface MailContent {
  to: string;
  subject: string;
  paragraphs: string[];
  link: { href: string; label: string };
  footer?: string;
}

const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

export function composeMail({ to, subject, paragraphs, link, footer }: MailContent): MailMessage {
  const text = [...paragraphs, `${link.label}: ${link.href}`, ...(footer ? [footer] : [])].join('\n\n');
  const html = [
    ...paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`),
    `<p><a href="${escapeHtml(link.href)}">${escapeHtml(link.label)}</a></p>`,
    ...(footer ? [`<p style="color:#637372;font-size:12px">${escapeHtml(footer)}</p>`] : []),
  ].join('\n');
  return { to, subject, text, html };
}
