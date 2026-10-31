'use strict';

// Outgoing email. If SMTP_HOST is set in .env, mail goes out through nodemailer.
// Otherwise (local dev / demo) each mail is printed to the console and saved as a
// .txt file in backend/data/outbox/ so reset links and invoices can still be opened.
//   await sendMail({ to, subject, text, html })

const fs = require('node:fs');
const path = require('node:path');
const config = require('../config');

let transport = null;
function getTransport() {
  if (transport || !process.env.SMTP_HOST) return transport;
  const nodemailer = require('nodemailer');
  transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === 'true',
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });
  return transport;
}

const outboxDir = config.dbFile === ':memory:' ? null : path.join(path.dirname(config.dbFile), 'outbox');

/** Last mails sent in this process (handy for tests). */
const sent = [];

async function sendMail({ to, subject, text, html }) {
  const from = process.env.MAIL_FROM || 'Brightloop <no-reply@brightloop.test>';
  sent.push({ from, to, subject, text, html, at: new Date().toISOString() });
  if (sent.length > 50) sent.shift();

  const t = getTransport();
  if (t) {
    await t.sendMail({ from, to, subject, text, html });
    return { delivered: true };
  }
  if (process.env.NODE_ENV !== 'test') console.log(`[mail] to=${to} subject="${subject}"\n${text}\n`);
  if (outboxDir) {
    fs.mkdirSync(outboxDir, { recursive: true });
    const file = `${Date.now()}-${String(to).replace(/[^a-z0-9@.]/gi, '_')}.txt`;
    fs.writeFileSync(path.join(outboxDir, file), `To: ${to}\nSubject: ${subject}\n\n${text}\n`);
  }
  return { delivered: false };
}

module.exports = { sendMail, sent };
