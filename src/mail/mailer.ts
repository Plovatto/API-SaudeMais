export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  attachments?: { filename: string; content: Buffer; cid: string }[];
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
}
