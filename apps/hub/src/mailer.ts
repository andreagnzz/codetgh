import nodemailer from "nodemailer";

export type Mail = { to: string; subject: string; text: string };
export type Mailer = { send: (mail: Mail) => Promise<void>; enabled: boolean; outbox: Mail[] };

// SMTP_URL selects any provider (smtp://… or smtps://…); without it, jsonTransport keeps mail in memory for dev and tests.
export function createMailer(smtpUrl?: string, from = "CodeTgh <no-reply@codetgh.local>"): Mailer {
  const transport = smtpUrl ? nodemailer.createTransport(smtpUrl) : nodemailer.createTransport({ jsonTransport: true });
  const outbox: Mail[] = [];
  return {
    enabled: Boolean(smtpUrl),
    outbox,
    async send(mail) {
      await transport.sendMail({ from, ...mail });
      if (!smtpUrl) outbox.push(mail);
    },
  };
}
