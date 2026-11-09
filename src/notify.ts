import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import nodemailer from "nodemailer";

export interface SendResult {
  sent: boolean;
  path: string;
  reason?: string;
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

export async function sendDigest(options: {
  subject: string;
  html: string;
  text: string;
  to: string;
  enabled: boolean;
}): Promise<SendResult> {
  const outbox = join(process.cwd(), "data", "outbox");
  mkdirSync(outbox, { recursive: true });
  const base = join(outbox, `digest-${timestamp()}`);
  writeFileSync(`${base}.html`, options.html, "utf8");
  writeFileSync(`${base}.txt`, options.text, "utf8");

  if (!options.enabled) {
    return { sent: false, path: base, reason: "email desativado nas configurações" };
  }

  const host = process.env.SMTP_HOST?.trim();
  const port = Number(process.env.SMTP_PORT ?? 587);
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS?.trim();
  const from = process.env.MAIL_FROM?.trim() || user;

  if (!host || !user || !pass || !from) {
    return {
      sent: false,
      path: base,
      reason: "SMTP não configurado (SMTP_HOST, SMTP_USER, SMTP_PASS, MAIL_FROM)"
    };
  }

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: process.env.SMTP_SECURE === "true" || port === 465,
    auth: { user, pass }
  });

  await transporter.sendMail({
    from,
    to: options.to,
    subject: options.subject,
    text: options.text,
    html: options.html
  });

  return { sent: true, path: base };
}
