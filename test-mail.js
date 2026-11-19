// Run with: node test-mail.js
require('dotenv').config();
const nodemailer = require('nodemailer');

const user = process.env.GMAIL_USER;
const pass = (process.env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, '');
const to = process.env.FEEDBACK_RECEIVER || user;

if (!user || !pass) {
  console.log('FAILED: GMAIL_USER or GMAIL_APP_PASSWORD is missing in .env');
  process.exit(1);
}

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user, pass }
});

transporter.verify()
  .then(() => {
    console.log('LOGIN OK');
    return transporter.sendMail({
      from: user,
      to,
      subject: 'CSPC Feedback - test email',
      text: 'If you can read this, email sending works.'
    });
  })
  .then(info => console.log('TEST EMAIL SENT to', to, '-', info.response))
  .catch(e => console.log('FAILED:', e.message));
