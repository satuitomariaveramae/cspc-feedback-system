const nodemailer = require('nodemailer');

// ---------------------------------------------------------------------------
// Mail transport
//
// Preferred: Brevo HTTPS API (set BREVO_API_KEY). Works on Render free tier,
// where SMTP is usually blocked.
// Fallback: Gmail SMTP with an App Password (works locally).
//
// Env variables:
//   BREVO_API_KEY       Brevo API key (production)
//   BREVO_SENDER_EMAIL  optional, defaults to GMAIL_USER (must be a verified Brevo sender)
//   GMAIL_USER          sender address (cspcfeedback@gmail.com)
//   GMAIL_APP_PASSWORD  Gmail app password (local fallback)
// ---------------------------------------------------------------------------

let transporter = null;
let warned = false;

function senderEmail() {
  return process.env.BREVO_SENDER_EMAIL || process.env.GMAIL_USER;
}

// Same interface as nodemailer's sendMail, so the functions below don't change.
function makeBrevoTransport(apiKey) {
  return {
    async sendMail({ to, subject, text, html, replyTo }) {
      const body = {
        sender: { name: 'CSPC Feedback System', email: senderEmail() },
        to: [{ email: to }],
        subject,
        textContent: text,
        htmlContent: html
      };
      if (replyTo) body.replyTo = { email: replyTo };

      const res = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'api-key': apiKey,
          'content-type': 'application/json',
          accept: 'application/json'
        },
        body: JSON.stringify(body)
      });
      if (!res.ok) {
        throw new Error('Brevo ' + res.status + ': ' + (await res.text()));
      }
      return res.json();
    }
  };
}

function getTransporter() {
  if (transporter) return transporter;

  if (process.env.BREVO_API_KEY) {
    transporter = makeBrevoTransport(process.env.BREVO_API_KEY);
    return transporter;
  }

  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;

  if (!user || !pass) {
    if (!warned) {
      console.warn(
        '[mailer] No BREVO_API_KEY or GMAIL credentials set — ' +
          'emails will be logged to the console instead of sent.'
      );
      warned = true;
    }
    return null;
  }

  transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user, pass }
  });

  return transporter;
}

/**
 * Sends the password-reset email containing the reset link and the 6-digit
 * backup code. Falls back to console logging if no mail is configured.
 */
async function sendPasswordResetEmail({ to, resetUrl, code, fullName }) {
  const subject = 'CSPC Feedback System — Admin Password Reset';
  const text =
    `Hi ${fullName || 'Admin'},\n\n` +
    `We received a request to reset your CSPC Feedback & Suggestion System admin password.\n\n` +
    `Reset link (valid for 30 minutes):\n${resetUrl}\n\n` +
    `If the link does not work, you can enter this 6-digit code manually on the reset page:\n${code}\n\n` +
    `If you did not request this, you can safely ignore this email — your password will not change.\n\n` +
    `— CSPC Feedback & Suggestion System`;

  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;padding:24px;border:1px solid #e5e9f0;border-radius:10px;">
      <h2 style="color:#0b2a4a;margin-top:0;">Admin Password Reset</h2>
      <p>Hi ${fullName || 'Admin'},</p>
      <p>We received a request to reset your <strong>CSPC Feedback &amp; Suggestion System</strong> admin password.</p>
      <p style="text-align:center;margin:28px 0;">
        <a href="${resetUrl}" style="background:#F5A623;color:#0b2a4a;font-weight:700;text-decoration:none;padding:12px 24px;border-radius:8px;display:inline-block;">Reset Password</a>
      </p>
      <p>Or use this link:<br><a href="${resetUrl}">${resetUrl}</a></p>
      <p>If the button/link doesn't work, enter this 6-digit code on the reset page:</p>
      <p style="font-size:24px;font-weight:700;letter-spacing:4px;color:#0b2a4a;">${code}</p>
      <p style="color:#6b7385;font-size:13px;">This link and code expire in 30 minutes. If you didn't request this, you can safely ignore this email.</p>
    </div>
  `;

  const t = getTransporter();

  if (!t) {
    console.log('--------------------------------------------------');
    console.log('[mailer] Mail not configured — printing reset email instead:');
    console.log('To:', to);
    console.log('Subject:', subject);
    console.log(text);
    console.log('--------------------------------------------------');
    return { delivered: false, reason: 'no-credentials' };
  }

  await t.sendMail({
    from: `"CSPC Feedback System" <${senderEmail()}>`,
    to,
    subject,
    text,
    html
  });

  return { delivered: true };
}

// ---------------------------------------------------------------------------
// Feedback notifications
// ---------------------------------------------------------------------------

// Escape user-supplied text before putting it inside HTML emails.
function esc(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function getReceiver() {
  // Change FEEDBACK_RECEIVER when an official address is available.
  // Falls back to the sending account so the demo always works.
  return process.env.FEEDBACK_RECEIVER || process.env.GMAIL_USER;
}

/**
 * Notifies the office/admin that a new submission arrived.
 * Anonymous submissions never include name/email/ID.
 */
async function sendNewFeedbackEmail(fb) {
  const t = getTransporter();
  const to = getReceiver();
  const subject = `[${fb.ticket_no}] New ${fb.feedback_type}: ${fb.subject}`;
  const anon = !!fb.is_anonymous;
  const who = anon
    ? 'Anonymous'
    : `${fb.full_name} (${fb.email})${fb.student_id ? ' — ID: ' + fb.student_id : ''}`;

  const text =
    `A new submission was received.\n\n` +
    `Ticket:     ${fb.ticket_no}\n` +
    `Type:       ${fb.feedback_type}\n` +
    `Department: ${fb.college}\n` +
    `Category:   ${fb.category}\n` +
    `From:       ${who}\n\n` +
    `Subject: ${fb.subject}\n\n${fb.message}\n`;

  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;padding:24px;border:1px solid #e5e9f0;border-radius:10px;">
      <h2 style="color:#0b2a4a;margin-top:0;">New ${esc(fb.feedback_type)} received</h2>
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <tr><td style="padding:6px 0;color:#6b7385;width:110px;">Ticket</td><td><strong>${esc(fb.ticket_no)}</strong></td></tr>
        <tr><td style="padding:6px 0;color:#6b7385;">Department</td><td>${esc(fb.college)}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7385;">Category</td><td>${esc(fb.category)}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7385;">From</td><td>${esc(who)}</td></tr>
      </table>
      <hr style="border:none;border-top:1px solid #e5e9f0;margin:16px 0;">
      <p style="font-weight:700;color:#0b2a4a;margin:0 0 8px;">${esc(fb.subject)}</p>
      <p style="white-space:pre-wrap;margin:0;">${esc(fb.message)}</p>
    </div>`;

  if (!t) {
    console.log('[mailer] Mail not configured — would have sent notification:\n' + text);
    return { delivered: false, reason: 'no-credentials' };
  }

  await t.sendMail({
    from: `"CSPC Feedback System" <${senderEmail()}>`,
    to,
    // Reply goes straight to the student (not for anonymous submissions).
    replyTo: !anon && fb.email ? fb.email : undefined,
    subject,
    text,
    html
  });
  return { delivered: true };
}

/**
 * Confirmation email to the person who submitted (skipped if anonymous).
 */
async function sendConfirmationEmail(fb) {
  if (fb.is_anonymous || !fb.email) return { delivered: false, reason: 'anonymous' };
  const t = getTransporter();
  if (!t) return { delivered: false, reason: 'no-credentials' };

  const base = process.env.PUBLIC_URL || process.env.APP_URL || 'http://localhost:3000';
  const trackUrl = `${base}/track?ticket=${encodeURIComponent(fb.ticket_no)}`;

  const text =
    `Hi ${fb.full_name},\n\n` +
    `Thank you! We received your ${fb.feedback_type.toLowerCase()}.\n\n` +
    `Ticket number: ${fb.ticket_no}\nSubject: ${fb.subject}\n\n` +
    `Track its status here:\n${trackUrl}\n\n` +
    `— CSPC Feedback & Suggestion System`;

  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;padding:24px;border:1px solid #e5e9f0;border-radius:10px;">
      <h2 style="color:#0b2a4a;margin-top:0;">We received your ${esc(fb.feedback_type.toLowerCase())}</h2>
      <p>Hi ${esc(fb.full_name)}, thank you for reaching out.</p>
      <p>Your ticket number:</p>
      <p style="font-size:22px;font-weight:700;letter-spacing:1px;color:#0b2a4a;">${esc(fb.ticket_no)}</p>
      <p><strong>Subject:</strong> ${esc(fb.subject)}</p>
      <p style="text-align:center;margin:24px 0;">
        <a href="${esc(trackUrl)}" style="background:#F5A623;color:#0b2a4a;font-weight:700;text-decoration:none;padding:12px 24px;border-radius:8px;display:inline-block;">Track my submission</a>
      </p>
    </div>`;

  await t.sendMail({
    from: `"CSPC Feedback System" <${senderEmail()}>`,
    to: fb.email,
    subject: `We received your submission [${fb.ticket_no}]`,
    text,
    html
  });
  return { delivered: true };
}

module.exports = {
  sendPasswordResetEmail,
  sendNewFeedbackEmail,
  sendConfirmationEmail
};