import { readFileSync } from 'node:fs';
import type { MailMessage } from './mailer.js';

interface MailContent {
  to: string;
  subject: string;
  heading?: string;
  paragraphs: string[];
  link: { href: string; label: string };
  footer?: string;
}

const BRAND = 'Saúde+';
const TAGLINE = 'Sua saúde, seus horários, em um só lugar.';
const LOGO_CID = 'logo@saudemais.plovatto.dev';
const logo = readFileSync(new URL('./email-logo.png', import.meta.url));
const FONT = "'Segoe UI',Helvetica,Arial,sans-serif";

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

function originOf(href: string): string | undefined {
  try {
    const url = new URL(href);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.origin : undefined;
  } catch {
    return undefined;
  }
}

const styles = `
  body,table,td,p,a,h1{-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}
  img{border:0;outline:none;text-decoration:none}
  @media only screen and (max-width:620px){
    .outer{padding:24px 12px!important}
    .pad{padding-left:24px!important;padding-right:24px!important}
    .title{font-size:28px!important}
    .cta-table{width:100%!important}
    .cta{display:block!important}
  }
  @media (prefers-color-scheme:dark){
    .page{background-color:#0b1213!important}
    .card{background-color:#121b1c!important;border-color:#223132!important}
    .title,.strong{color:#e6eeee!important}
    .text{color:#c3d0d0!important}
    .muted{color:#8d9d9d!important}
    .box{background-color:#162122!important;border-color:#2c4040!important}
    .rule{border-color:#223132!important}
    .link{color:#5fd6d8!important}
  }
`;

const header = `
<tr>
  <td class="pad" bgcolor="#0b5152" style="background-color:#0b5152;background-image:linear-gradient(120deg,#083e3f,#126b6d);padding:22px 36px;border-radius:20px 20px 0 0">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td width="46" height="46" align="center" valign="middle" bgcolor="#246d6e" style="background-color:#246d6e;border-radius:12px">
          <img src="cid:${LOGO_CID}" width="28" height="25" alt="" style="display:block;width:28px;height:25px">
        </td>
        <td valign="middle" style="padding-left:12px;font-family:${FONT};font-size:24px;font-weight:700;letter-spacing:-0.5px;color:#ffffff;line-height:1.2">${BRAND}</td>
      </tr>
    </table>
  </td>
</tr>`;

const button = (href: string, label: string) => `
<table role="presentation" class="cta-table" cellpadding="0" cellspacing="0" border="0">
  <tr>
    <td align="center" bgcolor="#086e70" style="background-color:#086e70;border-radius:10px;mso-padding-alt:14px 24px">
      <a class="cta" href="${escapeHtml(href)}" style="display:inline-block;padding:14px 24px;font-family:${FONT};font-size:16px;line-height:22px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:10px;mso-padding-alt:0">${escapeHtml(label)}</a>
    </td>
  </tr>
</table>`;

export function composeMail({ to, subject, heading, paragraphs, link, footer }: MailContent): MailMessage {
  const text = [
    ...(heading ? [heading] : []),
    ...paragraphs,
    `${link.label}: ${link.href}`,
    ...(footer ? [footer] : []),
  ].join('\n\n');

  const origin = originOf(link.href);
  const actionUrl = escapeHtml(link.href);

  const body = paragraphs
    .map(
      (paragraph) =>
        `<p class="text" style="margin:0 0 14px;font-family:${FONT};font-size:16px;line-height:1.6;color:#344847">${escapeHtml(paragraph)}</p>`,
    )
    .join('\n');

  const legalLinks = origin
    ? `<a class="link" href="${escapeHtml(origin)}/privacidade" style="color:#0a6668;text-decoration:underline">Política de privacidade</a> &nbsp;·&nbsp; <a class="link" href="${escapeHtml(origin)}/termos" style="color:#0a6668;text-decoration:underline">Termos de uso</a>`
    : '';

  const html = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${escapeHtml(subject)}</title>
<style>${styles}</style>
</head>
<body class="page" style="margin:0;padding:0;background-color:#edf5f4">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all">${escapeHtml(paragraphs[0] ?? subject)}</div>
<table role="presentation" class="page" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#edf5f4" style="background-color:#edf5f4">
  <tr>
    <td class="outer" align="center" style="padding:40px 16px">
      <!--[if mso]><table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:560px;table-layout:fixed">
        ${header}
        <tr>
          <td class="pad card" bgcolor="#ffffff" style="background-color:#ffffff;padding:32px 36px;border:1px solid #dce9e7;border-top:0;border-radius:0 0 20px 20px">
            ${heading ? `<h1 class="title" style="margin:0 0 16px;font-family:${FONT};font-size:32px;line-height:1.16;font-weight:750;letter-spacing:-0.8px;color:#132d2c">${escapeHtml(heading)}</h1>` : ''}
            ${body}
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="table-layout:fixed">
              <tr>
                <td style="padding:6px 0 24px">${button(link.href, link.label)}</td>
              </tr>
              <tr>
                <td class="rule" style="padding-top:20px;border-top:1px solid #e0ecea">
                  <p class="strong" style="margin:0 0 8px;font-family:${FONT};font-size:13px;font-weight:700;line-height:1.5;color:#344847">O botão não abriu? Copie o link abaixo.</p>
                  <p class="box" style="margin:0;padding:10px 12px;background-color:#f2f8f7;border:1px solid #deebe9;border-radius:8px;font-family:${FONT};font-size:13px;line-height:1.5;word-break:break-all;overflow-wrap:anywhere"><a class="link" href="${actionUrl}" style="color:#0a6668;text-decoration:underline">${actionUrl}</a></p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td class="pad" align="center" style="padding:20px 24px 0">
            ${footer ? `<p class="text" style="margin:0 0 14px;font-family:${FONT};font-size:13px;line-height:1.6;color:#344847">${escapeHtml(footer)}</p>` : ''}
            <p class="muted" style="margin:0 0 8px;font-family:${FONT};font-size:12px;line-height:1.6;color:#546968">${TAGLINE}</p>
            ${legalLinks ? `<p class="muted" style="margin:0 0 8px;font-family:${FONT};font-size:12px;line-height:1.6;color:#546968">${legalLinks}</p>` : ''}
            <p class="muted" style="margin:0;font-family:${FONT};font-size:12px;line-height:1.6;color:#546968">Esta é uma mensagem automática. Não responda a este e-mail.</p>
          </td>
        </tr>
      </table>
      <!--[if mso]></td></tr></table><![endif]-->
    </td>
  </tr>
</table>
</body>
</html>`;

  return { to, subject, text, html, attachments: [{ filename: 'email-logo.png', content: logo, cid: LOGO_CID }] };
}
