import nodemailer from 'nodemailer';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

/** Outbound email. SMTP (Mailpit locally); tests use the in-memory outbox. Never calls a live service from tests. */
export interface EmailSender {
  send(m: EmailMessage): Promise<void>;
}

export class SmtpEmailSender implements EmailSender {
  private readonly transport;
  constructor(
    private readonly from: string,
    opts: { host: string; port: number; user?: string; password?: string },
  ) {
    this.transport = nodemailer.createTransport({
      host: opts.host,
      port: opts.port,
      secure: opts.port === 465,
      ...(opts.user ? { auth: { user: opts.user, pass: opts.password } } : {}),
    });
  }
  async send(m: EmailMessage) {
    await this.transport.sendMail({ from: this.from, to: m.to, subject: m.subject, text: m.text });
  }
}

/** Test double and local fallback: keeps messages in memory. */
export class MemoryEmailSender implements EmailSender {
  readonly sent: EmailMessage[] = [];
  failNext = 0;
  async send(m: EmailMessage) {
    if (this.failNext > 0) {
      this.failNext--;
      throw new Error('simulated email failure');
    }
    this.sent.push(m);
  }
}

/**
 * SMS is a named interface only: FLOW 2 does not collect phone numbers and no provider is chosen yet (SPEC open
 * question), so invites go by email. A provider plugs in here.
 */
export interface SmsSender {
  send(to: string, text: string): Promise<void>;
}
