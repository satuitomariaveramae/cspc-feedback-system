require('dotenv').config();

const express = require('express');
require('express-async-errors'); // lets async route handlers forward errors to Express
const session = require('express-session');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const bodyParser = require('body-parser');
const MySQLStore = require('express-mysql-session')(session);

const { db, initDb, generateTicketNo } = require('./database/db');
const { sendPasswordResetEmail, sendNewFeedbackEmail, sendConfirmationEmail } = require('./database/mailer');

const app = express();
const PORT = process.env.PORT || 3000;

// Wrap async route handlers so a rejected promise reaches the error handler.
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

if (process.env.NODE_ENV === 'production' && !process.env.SESSION_SECRET) {
  console.error('SESSION_SECRET is required in production.');
  process.exit(1);
}

// ---------- View engine ----------
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ---------- Middleware ----------
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------- Split portals (public form vs. admin panel) ----------
// Set PUBLIC_URL and ADMIN_URL in .env to serve the two areas on separate
// hostnames from this one app + one database, e.g.
//   PUBLIC_URL=https://feedback.cspc.edu.ph
//   ADMIN_URL=https://admin-feedback.cspc.edu.ph
// If they are not set (e.g. local development) every route works on any host.
function hostOf(url) {
  try { return new URL(url).hostname.toLowerCase(); } catch (e) { return null; }
}
const PUBLIC_URL = (process.env.PUBLIC_URL || '').replace(/\/+$/, '');
const ADMIN_URL = (process.env.ADMIN_URL || '').replace(/\/+$/, '');
const PUBLIC_HOST = hostOf(PUBLIC_URL);
const ADMIN_HOST = hostOf(ADMIN_URL);
const SPLIT_MODE = Boolean(PUBLIC_HOST && ADMIN_HOST && PUBLIC_HOST !== ADMIN_HOST);

if (process.env.NODE_ENV === 'production' || SPLIT_MODE) {
  app.set('trust proxy', 1); // running behind nginx / a reverse proxy
}

app.locals.SPLIT_MODE = SPLIT_MODE;
app.locals.PUBLIC_URL = SPLIT_MODE ? PUBLIC_URL : '';
app.locals.ADMIN_URL = SPLIT_MODE ? ADMIN_URL : '';

if (SPLIT_MODE) {
  console.log(`[portals] public -> ${PUBLIC_HOST} | admin -> ${ADMIN_HOST}`);

  const PUBLIC_PATHS = /^\/(submit|success|track|help|privacy|terms|contact)(\/|$)/;

  app.use((req, res, next) => {
    const host = (req.hostname || '').toLowerCase();
    const notFound = () => res.status(404).render('404', { title: 'Not Found' });

    if (host === ADMIN_HOST) {
      // Admin portal: only /admin/* (plus "/" which goes to the login page).
      if (req.path === '/') return res.redirect('/admin/login');
      if (!req.path.startsWith('/admin')) return notFound();
      return next();
    }

    // Any other host (including feedback.cspc.edu.ph) is the public portal:
    // the admin panel simply does not exist here.
    if (req.path.startsWith('/admin')) return notFound();
    if (req.path === '/' || PUBLIC_PATHS.test(req.path)) return next();
    return notFound();
  });
}

app.use(
  session({
    store: new MySQLStore(
      {
        clearExpired: true,
        checkExpirationInterval: 15 * 60 * 1000,
        expiration: 8 * 60 * 60 * 1000,
        createDatabaseTable: true
      },
      db.pool
    ),
    secret: process.env.SESSION_SECRET || 'dev-only-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 1000 * 60 * 60 * 8, // 8 hours
      httpOnly: true,
      sameSite: 'lax',
      // Only send the cookie over HTTPS in production / split-portal mode.
      secure: process.env.NODE_ENV === 'production' || SPLIT_MODE
    }
  })
);

// Flash-style one-time messages via session
app.use((req, res, next) => {
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;
  res.locals.admin = req.session.admin || null;
  next();
});

function setFlash(req, type, text, field) {
  req.session.flash = { type, text, field: field || null };
}

const requireAuth = wrap(async function requireAuth(req, res, next) {
  if (req.session.admin) {
    // Bell notifications: pending count + 5 newest pending tickets
    const { c: count } = await db.get(`SELECT COUNT(*) c FROM feedbacks WHERE status = 'Pending'`);
    const items = (await db
      .all(`SELECT id, ticket_no, subject, feedback_type, created_at FROM feedbacks WHERE status = 'Pending' ORDER BY created_at DESC, id DESC LIMIT 5`))
      .map(r => ({ id: r.id, ticket_no: r.ticket_no, subject: r.subject, type: r.feedback_type, ago: timeAgo(r.created_at) }));
    res.locals.notif = { count, items };
    return next();
  }
  setFlash(req, 'error', 'Please log in to access the admin panel.');
  return res.redirect('/admin/login');
});

// ---------- Constants ----------
const COLLEGES = [
  'College of Engineering and Architecture',
  'College of Computer Studies',
  'College of Arts and Sciences',
  'College of Tourism, Hospitality and Business Management',
  'College of Health Sciences'
];

const CATEGORIES = [
  'Academic Affairs',
  'Faculty & Staff',
  'Facilities & Equipment',
  'Administration & Services',
  'Canteen & Amenities',
  'Library',
  'ICT / Online Systems',
  'Other'
];

const STATUSES = ['Pending', 'In Review', 'Resolved', 'Closed'];
const TYPES = ['Feedback', 'Suggestion', 'Complaint'];

app.locals.COLLEGES = COLLEGES;
// View helpers shared by the admin dashboard / feedback list pages.
const COLLEGE_SHORT = {
  'College of Computer Studies': 'CCS',
  'College of Health Sciences': 'Health Sci.',
  'College of Arts and Sciences': 'Arts & Sci.',
  'College of Engineering': 'Engineering',
  'College of Engineering and Architecture': 'COE'
};
app.locals.shortCollege = (name) => COLLEGE_SHORT[name] || String(name || '').replace(/^College of /, '');
app.locals.statusClass = (st) => 'st-' + String(st).replace(/\s+/g, '-').toLowerCase();
app.locals.CATEGORIES = CATEGORIES;
app.locals.STATUSES = STATUSES;
app.locals.TYPES = TYPES;
app.locals.icon = require('./lib/icons');
app.locals.SUPPORT = {
  phone: process.env.SUPPORT_PHONE || '+63 950 357 7267',
  hours: process.env.SUPPORT_HOURS || 'Monday to Friday, 8:00 AM \u2013 5:00 PM',
  location: process.env.SUPPORT_LOCATION || 'Office of Student Affairs and Services, CSPC Main Campus',
  response: process.env.SUPPORT_RESPONSE || '3 to 5 working days'
};

// "2 days ago"-style label from a SQLite CURRENT_TIMESTAMP (UTC) value
function timeAgo(sqlDate) {
  const t = Date.parse(String(sqlDate).replace(' ', 'T') + 'Z');
  if (isNaN(t)) return '';
  const mins = Math.max(0, Math.floor((Date.now() - t) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min${mins === 1 ? '' : 's'} ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? '' : 's'} ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;
  const wks = Math.floor(days / 7);
  if (days < 30) return `${wks} week${wks === 1 ? '' : 's'} ago`;
  const mos = Math.floor(days / 30);
  return mos < 12 ? `${mos} month${mos === 1 ? '' : 's'} ago` : 'over a year ago';
}
const STATUS_VIEW = {
  'Pending':   { kind: 'pending',  label: 'Pending' },
  'In Review': { kind: 'progress', label: 'In progress' },
  'Resolved':  { kind: 'done',     label: 'Resolved' },
  'Closed':    { kind: 'done',     label: 'Closed' }
};

// =====================================================
// PUBLIC ROUTES
// =====================================================

app.get('/', async (req, res) => {
  // Sidebar "Recent Submissions": type + status + time only.
  // Never shows subject, category, name, email, or message.
  let recent = [];
  try {
    recent = (await db.all(
        `SELECT feedback_type, status, created_at FROM feedbacks
         ORDER BY created_at DESC, id DESC LIMIT 3`
      ))
      .map((r) => {
        const v = STATUS_VIEW[r.status] || STATUS_VIEW['Pending'];
        return {
          title: `${r.feedback_type} submitted`,
          kind: v.kind,
          label: v.label,
          ago: timeAgo(r.created_at)
        };
      });
  } catch (err) {
    console.error(err);
  }
  res.render('index', { title: 'Submit Feedback', recent });
});

app.post('/submit', async (req, res) => {
  try {
    const {
      full_name,
      email,
      student_id,
      college,
      category,
      feedback_type,
      subject,
      message,
      rating,
      is_anonymous
    } = req.body;

    if (!college || !category || !subject || !message) {
      setFlash(req, 'error', 'Please fill in all required fields.');
      return res.redirect('/');
    }

    const anonymous = is_anonymous === 'on' ? 1 : 0;

    if (!anonymous) {
      if (!(full_name || '').trim() || !(email || '').trim()) {
        setFlash(req, 'error', 'Please provide your name and email, or switch on "Submit Anonymously".');
        return res.redirect('/');
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
        setFlash(req, 'error', 'Please enter a valid email address.');
        return res.redirect('/');
      }
    }
    if (subject.length > 120 || message.length > 1000) {
      setFlash(req, 'error', 'Your subject or message is too long.');
      return res.redirect('/');
    }

    const ticket_no = await generateTicketNo();

    await db.run(
      `INSERT INTO feedbacks
        (ticket_no, full_name, email, student_id, college, category, feedback_type, subject, message, rating, is_anonymous)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
      ticket_no,
      anonymous ? null : (full_name || null),
      anonymous ? null : (email || null),
      anonymous ? null : (student_id || null),
      college,
      category,
      feedback_type || 'Feedback',
      subject,
      message,
      rating ? parseInt(rating, 10) : null,
      anonymous
      ]
    );

    // Send emails in the background so a mail problem never blocks the form.
    const saved = await db.get('SELECT * FROM feedbacks WHERE ticket_no = ?', [ticket_no]);
    console.log('[mailer] sending notification for', saved.ticket_no, 'to', process.env.FEEDBACK_RECEIVER || process.env.GMAIL_USER);
    sendNewFeedbackEmail(saved)
      .then((r) => console.log('[mailer] notify result:', JSON.stringify(r)))
      .catch((e) => console.error('[mailer] notify failed:', e.message));
    sendConfirmationEmail(saved)
      .then((r) => console.log('[mailer] confirm result:', JSON.stringify(r)))
      .catch((e) => console.error('[mailer] confirm failed:', e.message));

    res.redirect(`/success/${ticket_no}`);
  } catch (err) {
    console.error(err);
    setFlash(req, 'error', 'Something went wrong while submitting your feedback.');
    res.redirect('/');
  }
});

app.get('/success/:ticket', async (req, res) => {
  const fb = await db.get('SELECT * FROM feedbacks WHERE ticket_no = ?', [req.params.ticket]);
  if (!fb) return res.redirect('/');
  res.render('success', { title: 'Submitted', fb });
});

// Format a SQLite CURRENT_TIMESTAMP (UTC) value in Philippine time
function fmtManila(sqlDate) {
  const t = Date.parse(String(sqlDate).replace(' ', 'T') + 'Z');
  if (isNaN(t)) return '';
  return new Date(t).toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' });
}

app.get('/help', (req, res) => {
  res.render('help', { title: 'Help Center' });
});

app.get('/privacy', (req, res) => {
  res.render('privacy', { title: 'Privacy Policy' });
});

app.get('/terms', (req, res) => {
  res.render('terms', { title: 'Terms of Use' });
});

app.get('/contact', (req, res) => {
  res.render('contact', { title: 'Contact Us' });
});

app.get('/track', (req, res) => {
  res.render('track', {
    title: 'Track Feedback', result: null, searched: false,
    ticket_no: String(req.query.ticket || '').trim().slice(0, 40)
  });
});

app.post('/track', async (req, res) => {
  const raw = String(req.body.ticket_no || '').trim().slice(0, 40);
  const result = raw
    ? await db.get('SELECT * FROM feedbacks WHERE ticket_no = ?', [raw.toUpperCase()])
    : undefined;
  res.render('track', {
    title: 'Track Feedback',
    result: result || null,
    searched: true,
    ticket_no: raw,
    submittedAt: result ? fmtManila(result.created_at) : '',
    updatedAt: result ? fmtManila(result.updated_at || result.created_at) : ''
  });
});

// =====================================================
// ADMIN AUTH
// =====================================================

// ---- Login attempt limit (per IP + email) ----
// 5 wrong tries within 15 minutes locks that email on that device for 15 minutes.
// Kept in memory, so it resets when the server restarts.
const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_LOCK_MS = 15 * 60 * 1000;
const loginAttempts = new Map(); // key -> { count, first, lockedUntil }

function loginKey(req, username) {
  return `${req.ip}|${String(username).toLowerCase()}`;
}
function loginLockLeftMs(key) {
  const rec = loginAttempts.get(key);
  return rec && rec.lockedUntil > Date.now() ? rec.lockedUntil - Date.now() : 0;
}
// Records a failed try; returns how many tries are left before the lock.
function recordLoginFailure(key) {
  const now = Date.now();
  let rec = loginAttempts.get(key);
  if (!rec || now - rec.first > LOGIN_WINDOW_MS) rec = { count: 0, first: now, lockedUntil: 0 };
  rec.count += 1;
  if (rec.count >= LOGIN_MAX_ATTEMPTS) rec.lockedUntil = now + LOGIN_LOCK_MS;
  loginAttempts.set(key, rec);
  return Math.max(0, LOGIN_MAX_ATTEMPTS - rec.count);
}
setInterval(() => {
  const now = Date.now();
  for (const [k, r] of loginAttempts) {
    if (r.lockedUntil < now && now - r.first > LOGIN_WINDOW_MS) loginAttempts.delete(k);
  }
}, 10 * 60 * 1000).unref();

app.get('/admin/login', (req, res) => {
  if (req.session.admin) return res.redirect('/admin/dashboard');
  res.render('admin/login', { title: 'Admin Login' });
});

app.post('/admin/login', async (req, res) => {
  const username = (req.body.username || '').trim();
  const password = req.body.password || '';

  if (!username) {
    setFlash(req, 'error', 'Please enter your email address.', 'username');
    return res.redirect('/admin/login');
  }
  if (!password) {
    setFlash(req, 'error', 'Please enter your password.', 'password');
    return res.redirect('/admin/login');
  }
  if (req.body.terms_accepted !== 'on') {
    setFlash(req, 'error', 'You must agree to the Terms & Conditions before logging in.', 'terms');
    return res.redirect('/admin/login');
  }

  const key = loginKey(req, username);
  const lockMs = loginLockLeftMs(key);
  if (lockMs > 0) {
    const mins = Math.ceil(lockMs / 60000);
    setFlash(req, 'error', `Too many failed attempts. Please try again in ${mins} minute${mins === 1 ? '' : 's'}.`, 'password');
    return res.redirect('/admin/login');
  }

  const admin = await db.get('SELECT * FROM admins WHERE username = ? OR email = ?', [username, username]);

  // Same message whether the email or the password is wrong, so we don't
  // reveal which accounts exist.
  if (!admin || !bcrypt.compareSync(password, admin.password_hash)) {
    const left = recordLoginFailure(key);
    let msg = 'Invalid email or password.';
    if (left === 0) msg = `Too many failed attempts. Please try again in ${Math.ceil(LOGIN_LOCK_MS / 60000)} minutes.`;
    else if (left <= 2) msg += ` ${left} attempt${left === 1 ? '' : 's'} left before a temporary lock.`;
    setFlash(req, 'error', msg, 'password');
    return res.redirect('/admin/login');
  }

  loginAttempts.delete(key);
  req.session.admin = {
    id: admin.id,
    username: admin.username,
    full_name: admin.full_name,
    role: admin.role
  };
  setFlash(req, 'success', `Welcome back, ${admin.full_name}!`);
  res.redirect('/admin/dashboard');
});

app.post('/admin/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/admin/login'));
});

// =====================================================
// ADMIN — FORGOT / RESET PASSWORD
// =====================================================

const RESET_TOKEN_TTL_MS = 30 * 60 * 1000; // 30 minutes

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

const RESEND_COOLDOWN_S = 60;

// Generates a brand-new code + link token, overwriting the previous ones
// (so any earlier code stops working), and emails it to the admin.
async function issueResetCode(req, admin) {
  // Raw token backs the emailed link; only its hash (and the code's hash)
  // are stored in the DB.
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashToken(rawToken);
  const code = String(crypto.randomInt(100000, 999999));
  const expires = db.toSqlDate(new Date(Date.now() + RESET_TOKEN_TTL_MS));

  await db.run(
    `UPDATE admins SET reset_token_hash = ?, reset_token_expires = ? WHERE id = ?`,
    [`${tokenHash}:${hashToken(code)}`, expires, admin.id]
  );

  const baseUrl = ADMIN_URL || process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
  await sendPasswordResetEmail({
    to: admin.email,
    resetUrl: `${baseUrl}/admin/reset-password/${rawToken}`,
    code,
    fullName: admin.full_name
  });
}

function resendCooldownLeft(req) {
  const last = req.session.lastResendAt || 0;
  return Math.max(0, Math.ceil(RESEND_COOLDOWN_S - (Date.now() - last) / 1000));
}

// ---- Forgot password: request a reset code ----

const ADMIN_EMAIL_DOMAIN = '@my.cspc.edu.ph';

app.get('/admin/forgot-password', (req, res) => {
  if (req.session.admin) return res.redirect('/admin/dashboard');
  res.render('admin/forgot-password', { title: 'Forgot Password' });
});

app.post('/admin/forgot-password', async (req, res) => {
  // "Resend code" reuses the email held in the session, so the address is
  // never placed in the page markup.
  const isResend = req.body.resend === '1';
  const email = (isResend ? (req.session.resetEmail || '') : (req.body.identifier || ''))
    .trim()
    .toLowerCase();

  try {
    if (!email) {
      setFlash(req, 'error', isResend
        ? 'Your session has expired. Please enter your email address again.'
        : 'Please enter your email address.', 'identifier');
      return res.redirect('/admin/forgot-password');
    }

    const allowedAdmin = (process.env.DEFAULT_ADMIN_EMAIL || '').toLowerCase();
    if (email !== allowedAdmin && !/^[^\s@]+@my\.cspc\.edu\.ph$/.test(email)) {
      setFlash(req, 'error', 'Please use your official CSPC email address.', 'identifier');
      return res.redirect('/admin/forgot-password');
    }

    const admin = await db.get('SELECT * FROM admins WHERE email = ?', [email]);

    if (!admin) {
      setFlash(req, 'error', 'No account was found with this email address.', 'identifier');
      return res.redirect('/admin/forgot-password');
    }

    await issueResetCode(req, admin);

    // Step 3 of the spec: Verification Code screen.
    req.session.resetEmail = admin.email;
    res.render('admin/verify-code', { title: 'Verification Code', codeError: false, digits: '', cooldown: 0 });
  } catch (err) {
    console.error(err);
    setFlash(req, 'error', 'Something went wrong while processing your request. Please try again.');
    res.redirect('/admin/forgot-password');
  }
});

// ---- Resend code (AJAX): issues a new code, invalidating the old one ----

app.post('/admin/resend-code', async (req, res) => {
  const email = req.session.resetEmail;
  if (!email) {
    return res.status(401).json({ ok: false, message: 'Your session has expired. Please request a new code.' });
  }
  const wait = resendCooldownLeft(req);
  if (wait > 0) {
    return res.status(429).json({ ok: false, retryAfter: wait });
  }
  try {
    const admin = await db.get('SELECT * FROM admins WHERE email = ?', [email]);
    if (!admin) {
      return res.status(401).json({ ok: false, message: 'Your session has expired. Please request a new code.' });
    }
    await issueResetCode(req, admin);
    req.session.lastResendAt = Date.now();
    res.json({ ok: true, cooldown: RESEND_COOLDOWN_S });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: 'Something went wrong. Please try again.' });
  }
});

// ---- Enter the 6-digit code (also reachable directly, e.g. after Resend) ----

app.get('/admin/verify-code', (req, res) => {
  if (!req.session.resetEmail) return res.redirect('/admin/forgot-password');
  res.render('admin/verify-code', { title: 'Verification Code', codeError: false, digits: '', cooldown: resendCooldownLeft(req) });
});

// ---- Reset password: via emailed link (token in URL) ----

app.get('/admin/reset-password/:token', async (req, res) => {
  const tokenHash = hashToken(req.params.token);
  const admin = await db.get(
    `SELECT * FROM admins
     WHERE reset_token_hash LIKE ? AND reset_token_expires > ?`,
    [`${tokenHash}:%`, db.toSqlDate()]
  );

  if (!admin) {
    setFlash(req, 'error', 'This password reset link is invalid or has expired. Please request a new one.');
    return res.redirect('/admin/forgot-password');
  }

  res.render('admin/reset-password', { title: 'Reset Password', token: req.params.token, useCode: false });
});

app.post('/admin/reset-password/:token', async (req, res) => {
  const { password, confirm_password } = req.body;
  const token = req.params.token;
  const tokenHash = hashToken(token);

  const admin = await db.get(
    `SELECT * FROM admins
     WHERE reset_token_hash LIKE ? AND reset_token_expires > ?`,
    [`${tokenHash}:%`, db.toSqlDate()]
  );

  if (!admin) {
    setFlash(req, 'error', 'This password reset link is invalid or has expired. Please request a new one.');
    return res.redirect('/admin/forgot-password');
  }

  if (!password || password.length < 8) {
    setFlash(req, 'error', 'Password must be at least 8 characters long.');
    return res.redirect(`/admin/reset-password/${token}`);
  }

  if (password !== confirm_password) {
    setFlash(req, 'error', 'Passwords do not match.');
    return res.redirect(`/admin/reset-password/${token}`);
  }

  const newHash = bcrypt.hashSync(password, 10);
  await db.run(
    `UPDATE admins SET password_hash = ?, reset_token_hash = NULL, reset_token_expires = NULL WHERE id = ?`,
    [newHash, admin.id]
  );

  // Step 5 of the spec: a dedicated success screen with a Back to Login button.
  res.render('admin/reset-success', { title: 'Password Reset Successful' });
});

// ---- Reset password: via 6-digit code (manual entry, no link click) ----

app.post('/admin/reset-password/code/verify', async (req, res) => {
  const identifier = req.session.resetEmail || '';
  const code = (req.body.code || '').trim();

  if (!identifier) {
    setFlash(req, 'error', 'Your session has expired. Please request a new code.', 'identifier');
    return res.redirect('/admin/forgot-password');
  }

  const admin = await db.get(
    'SELECT * FROM admins WHERE (username = ? OR email = ?) AND reset_token_expires > ?',
    [identifier, identifier, db.toSqlDate()]
  );

  if (!admin || !admin.reset_token_hash || !admin.reset_token_hash.includes(':')) {
    setFlash(req, 'error', 'Your code has expired. Please request a new one.', 'identifier');
    return res.redirect('/admin/forgot-password');
  }

  const [, codeHash] = admin.reset_token_hash.split(':');
  if (codeHash !== hashToken(code)) {
    return res.render('admin/verify-code', {
      title: 'Verification Code',
      codeError: true,
      digits: code.replace(/\D/g, '').slice(0, 6),
      cooldown: resendCooldownLeft(req)
    });
  }

  // Code is correct — reuse the same token flow by issuing the admin a
  // one-time link token equivalent to the one already stored (its hash is
  // the first half of reset_token_hash), so we regenerate a fresh raw token
  // tied to a fresh hash to keep the reset link single-use and unguessable.
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashToken(rawToken);
  await db.run(`UPDATE admins SET reset_token_hash = ? WHERE id = ?`, [`${tokenHash}:${codeHash}`, admin.id]);

  res.redirect(`/admin/reset-password/${rawToken}`);
});

// =====================================================
// ADMIN DASHBOARD
// =====================================================

const DASH_RANGES = { '7': 'Last 7 Days', '30': 'Last 30 Days', all: 'All Time' };

// Builds the WHERE clause for the dashboard's date-range filter.
function dashRange(req) {
  const range = Object.prototype.hasOwnProperty.call(DASH_RANGES, req.query.range) ? req.query.range : 'all';
  if (range === 'all') return { range, where: '', params: [] };
  return { range, where: `WHERE created_at >= (UTC_TIMESTAMP() - INTERVAL ? DAY)`, params: [parseInt(range, 10)] };
}

app.get('/admin/dashboard', requireAuth, async (req, res) => {
  const { range, where, params } = dashRange(req);
  const and = where ? `${where} AND` : 'WHERE';

  const { c: total } = await db.get(`SELECT COUNT(*) c FROM feedbacks ${where}`, params);
  const { c: pending } = await db.get(`SELECT COUNT(*) c FROM feedbacks ${and} status = 'Pending'`, params);
  const { c: inReview } = await db.get(`SELECT COUNT(*) c FROM feedbacks ${and} status = 'In Review'`, params);
  const { c: resolved } = await db.get(`SELECT COUNT(*) c FROM feedbacks ${and} status = 'Resolved'`, params);

  const byCategory = await db.all(`SELECT category, COUNT(*) c FROM feedbacks ${where} GROUP BY category ORDER BY c DESC`, params);

  const byCollege = await db.all(`SELECT college, COUNT(*) c FROM feedbacks ${where} GROUP BY college ORDER BY c DESC`, params);

  const avgRatingRow = await db.get(`SELECT AVG(rating) a FROM feedbacks ${and} rating IS NOT NULL`, params);

  const recent = await db.all(`SELECT * FROM feedbacks ${where} ORDER BY created_at DESC LIMIT 8`, params);

  res.render('admin/dashboard', {
    title: 'Dashboard',
    stats: { total, pending, inReview, resolved, avgRating: avgRatingRow.a === null ? null : Number(avgRatingRow.a) },
    byCategory,
    byCollege,
    recent,
    range,
    rangeLabel: DASH_RANGES[range],
    ranges: DASH_RANGES
  });
});

// CSV export of the submissions in the selected date range ("Generate Report").
app.get('/admin/dashboard/report.csv', requireAuth, async (req, res) => {
  const { range, where, params } = dashRange(req);
  const rows = await db.all(`SELECT ticket_no, subject, category, feedback_type, college, status, rating, created_at FROM feedbacks ${where} ORDER BY created_at DESC`, params);

  const cell = (v) => {
    let t = v === null || v === undefined ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(t)) t = "'" + t; // neutralise spreadsheet formulas
    return `"${t.replace(/"/g, '""')}"`;
  };
  const head = ['Ticket', 'Subject', 'Category', 'Type', 'College / Department', 'Status', 'Rating', 'Submitted'];
  const lines = [head.map(cell).join(',')].concat(
    rows.map((r) => [r.ticket_no, r.subject, r.category, r.feedback_type, r.college, r.status, r.rating, r.created_at].map(cell).join(','))
  );

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="cspc-feedback-report-${range}.csv"`);
  res.send('\ufeff' + lines.join('\r\n'));
});

// =====================================================
// ADMIN FEEDBACK LIST / FILTER
// =====================================================

app.get('/admin/feedbacks', requireAuth, async (req, res) => {
  const { status, category, college, type, q } = req.query;

  let sql = 'SELECT * FROM feedbacks WHERE 1=1';
  const params = [];

  if (status) {
    sql += ' AND status = ?';
    params.push(status);
  }
  if (category) {
    sql += ' AND category = ?';
    params.push(category);
  }
  if (college) {
    sql += ' AND college = ?';
    params.push(college);
  }
  if (type) {
    sql += ' AND feedback_type = ?';
    params.push(type);
  }
  if (q) {
    // Search ticket, subject, message, category, type and college.
    // Colleges are stored by full name but shown as short names (COE, CCS...),
    // so a college also matches when the typed text is part of its short name.
    const like = `%${q}%`;
    const ql = q.toLowerCase();
    const matchedColleges = [...new Set([...COLLEGES, ...Object.keys(COLLEGE_SHORT)])].filter(
      (c) => c.toLowerCase().includes(ql) || app.locals.shortCollege(c).toLowerCase().includes(ql)
    );
    sql +=
      ' AND (subject LIKE ? OR message LIKE ? OR ticket_no LIKE ? OR category LIKE ? OR feedback_type LIKE ? OR college LIKE ?' +
      (matchedColleges.length ? ` OR college IN (${matchedColleges.map(() => '?').join(',')})` : '') +
      ')';
    params.push(like, like, like, like, like, like, ...matchedColleges);
  }

  sql += ' ORDER BY created_at DESC';

  const feedbacks = await db.all(sql, params);

  const { c: pendingCount } = await db.get(`SELECT COUNT(*) c FROM feedbacks WHERE status = 'Pending'`);

  res.render('admin/list', {
    title: 'All Feedback',
    feedbacks,
    pendingCount,
    filters: { status, category, college, type, q }
  });
});

// =====================================================
// ADMIN FEEDBACK DETAIL / UPDATE
// =====================================================

app.get('/admin/feedbacks/:id', requireAuth, async (req, res) => {
  const fb = await db.get('SELECT * FROM feedbacks WHERE id = ?', [req.params.id]);
  if (!fb) {
    setFlash(req, 'error', 'Feedback entry not found.');
    return res.redirect('/admin/feedbacks');
  }
  const { c: pendingCount } = await db.get(`SELECT COUNT(*) c FROM feedbacks WHERE status = 'Pending'`);
  res.render('admin/view', { title: `Ticket ${fb.ticket_no}`, fb, pendingCount });
});

app.post('/admin/feedbacks/:id/status', requireAuth, async (req, res) => {
  const { status, admin_notes } = req.body;
  await db.run(
    `UPDATE feedbacks SET status = ?, admin_notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [status, admin_notes || null, req.params.id]
  );
  setFlash(req, 'success', 'Feedback updated successfully.');
  res.redirect(`/admin/feedbacks/${req.params.id}`);
});

// =====================================================
// 404
// =====================================================
app.use((req, res) => {
  res.status(404).render('404', { title: 'Not Found' });
});

// Any error thrown in a route ends up here instead of hanging the request.
app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(500).send('Something went wrong. Please try again.');
});

initDb().then(() => app.listen(PORT, () => {
  console.log(`CSPC Feedback System listening on port ${PORT}`);
})).catch((err) => {
  console.error('Startup failed:', err.message);
  process.exit(1);
});
