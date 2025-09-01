import express from 'express';
import fetch from 'node-fetch';
import dotenv from 'dotenv';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import * as Sentry from '@sentry/node';

dotenv.config();

const app = express();
// Security middleware
// Use helmet but disable its CSP handling because we manage CSP (with nonces) ourselves below.
app.use(helmet({ contentSecurityPolicy: false }));
// Enforce HSTS for HTTPS deployments (maxAge in seconds, 180 days)
app.use(helmet.hsts({ maxAge: 15552000, includeSubDomains: true }));

// Hide implementation details
app.disable('x-powered-by');

app.use(express.json({ limit: '50kb' }));

// CORS: allow only configured origins.
// In production you MUST set ALLOWED_ORIGIN to a comma-separated list of exact origins.
const ALLOWED_ORIGIN = (process.env.ALLOWED_ORIGIN || '').trim();
const allowedOrigins = ALLOWED_ORIGIN ? ALLOWED_ORIGIN.split(',').map(s => s.trim()).filter(Boolean) : [];

if (process.env.NODE_ENV === 'production') {
  if (!allowedOrigins.length) {
    console.error('ERROR: ALLOWED_ORIGIN must be set in production to a comma-separated list of exact origins. Exiting.');
    process.exit(1);
  }
  if (allowedOrigins.includes('*')) {
    console.error('ERROR: ALLOWED_ORIGIN must not contain wildcard "*" in production. Exiting.');
    process.exit(1);
  }
}
const corsOptions = {
  origin: (origin, callback) => {
    // Allow non-browser requests with no origin (curl, server-to-server)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error('CORS not allowed'), false);
  }
};
app.use((req, res, next) => {
  cors(corsOptions)(req, res, (err) => {
    if (err) {
      res.status(403).json({ error: 'CORS not allowed' });
      return;
    }
    next();
  });
});

// Basic rate limiting (configurable via env)
// Stronger defaults in production
const RATE_LIMIT_WINDOW_MS = parseInt(process.env.RATE_LIMIT_WINDOW_MS || (process.env.NODE_ENV === 'production' ? '60000' : '60000'), 10);
const RATE_LIMIT_MAX = parseInt(process.env.RATE_LIMIT_MAX || (process.env.NODE_ENV === 'production' ? '30' : '60'), 10);
const limiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS,
  max: RATE_LIMIT_MAX,
});
app.use(limiter);

const API_KEY = process.env.GEMINI_API_KEY;
const API_URL = process.env.GEMINI_API_URL || 'https://api.example.com';

if (!API_KEY) {
  console.warn('GEMINI_API_KEY not set in server environment. Proxy will fail until set.');
}

// Initialize Sentry if provided
const SENTRY_DSN = process.env.SENTRY_DSN || '';
if (SENTRY_DSN) {
  Sentry.init({ dsn: SENTRY_DSN });
  console.log('Sentry initialized');
}

// Simple proxy endpoint that forwards safe requests to the API and never exposes the key to clients
app.post('/api/proxy', async (req, res) => {
  try {
    const resp = await fetch(`${API_URL}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`,
      },
      body: JSON.stringify(req.body),
    });
    const data = await resp.json();
    res.status(resp.status).json(data);
  } catch (err) {
    console.error('Proxy error', err);
    res.status(502).json({ error: 'Bad gateway' });
  }
});

// CSP report-only endpoint for rollout / monitoring of policy violations.
// Browsers will POST reports here when they encounter CSP violations if configured.
app.post('/csp-report', express.json({ type: ['application/csp-report', 'application/json'] }), (req, res) => {
  try {
    const report = req.body || {};
    // Basic, append-only logging of reports for manual inspection. In production, forward to your
    // logging/monitoring backend (Sentry, Datadog) and redact sensitive fields.
    const entry = { time: new Date().toISOString(), ip: req.ip, report };
    fs.appendFileSync('/tmp/csp-reports.log', JSON.stringify(entry) + '\n');
    if (SENTRY_DSN) {
      try {
        Sentry.captureEvent({
          level: 'warning',
          message: 'CSP violation reported',
          extra: { report, ip: req.ip },
        });
      } catch (e) {
        console.error('Failed to forward CSP report to Sentry', e);
      }
    }
    res.status(204).end();
  } catch (err) {
    console.error('Failed to log CSP report', err);
    res.status(500).end();
  }
});

const port = process.env.PORT || 3000;
// Serve static files from dist and inject CSP nonce into HTML responses
import fs from 'fs';
import path from 'path';
// Resolve dist relative to the project root (current working directory when starting the server)
// Using '../dist' was fragile and could resolve incorrectly depending on process.cwd().
const DIST_DIR = path.resolve(process.cwd(), 'dist');

function generateNonce() {
  return Buffer.from(Math.random().toString()).toString('base64').slice(0, 16);
}

// Serve static assets but do not auto-serve index.html — we want to inject a per-request CSP nonce
// into the HTML when serving the root. Setting `index: false` prevents express.static from
// returning the index so our app.get('/') handler can run and add the CSP header/meta.
app.use(express.static(DIST_DIR, { index: false }));

app.get('/', (req, res) => {
  const indexPath = path.join(DIST_DIR, 'index.html');
  let html = fs.readFileSync(indexPath, 'utf8');
  const nonce = generateNonce();
  const cspDirectives = `default-src 'self'; script-src 'self' 'nonce-${nonce}'; style-src 'self' 'nonce-${nonce}'; img-src 'self' data:; connect-src 'self' wss: https:; frame-ancestors 'none'; base-uri 'self'`;
  const csp = cspDirectives;
  // If REPORT_ONLY is set, send report-only header for rollout
  const reportOnly = process.env.REPORT_ONLY === '1' || process.env.REPORT_ONLY === 'true';
  if (reportOnly) {
    res.setHeader('Content-Security-Policy-Report-Only', cspDirectives + `; report-uri /csp-report`);
  } else {
    res.setHeader('Content-Security-Policy', csp);
    res.setHeader('Content-Security-Policy-Report-Only', `default-src 'none'`);
  }
  // Inject a meta tag placeholder for client-side scripts if needed
  html = html.replace('<!-- CSP_NONCE -->', `<meta name="csp-nonce" content="${nonce}">`);
  res.setHeader('Content-Security-Policy', csp);
  res.send(html);
});

app.listen(port, () => {
  console.log(`Server proxy and static server listening on port ${port}`);
});
