require('dotenv').config();
const path = require('path');
const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const Anthropic = require('@anthropic-ai/sdk');
const WikiClient = require('./wikiClient');
const { analyzeNotes } = require('./noteProcessor');

const app = express();
const PORT = process.env.PORT || 3000;
const WIKIJS_INTERNAL_URL = process.env.WIKIJS_INTERNAL_URL;

if (!WIKIJS_INTERNAL_URL) {
  console.error('FATAL: WIKIJS_INTERNAL_URL environment variable is required');
  process.exit(1);
}

// Wire real clients when env vars are present
const wikiClient =
  process.env.WIKIJS_API_TOKEN
    ? new WikiClient(WIKIJS_INTERNAL_URL, process.env.WIKIJS_API_TOKEN)
    : null;

const anthropic =
  process.env.ANTHROPIC_API_KEY
    ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    : null;

app.locals.wikiClient = wikiClient;

app.use(express.static(path.join(__dirname, 'public')));

// --- Upload routes ---

app.get('/upload', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'upload.html'));
});

app.post('/upload/analyze', express.json(), express.urlencoded({ extended: true }), async (req, res) => {
  const { notes } = req.body;
  if (!notes || !notes.trim()) {
    return res.status(400).json({ error: 'notes are required' });
  }

  if (!wikiClient || !anthropic) {
    return res.json({ proposals: [] });
  }

  try {
    const proposals = await analyzeNotes(notes, wikiClient, anthropic);
    res.json({ proposals });
  } catch (err) {
    console.error('Analysis error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/upload/apply', express.json(), express.urlencoded({ extended: true }), async (req, res) => {
  const { proposals } = req.body;
  if (!Array.isArray(proposals) || proposals.length === 0) {
    return res.status(400).json({ error: 'proposals array is required' });
  }

  const wc = req.app.locals.wikiClient;
  if (!wc) {
    return res.status(503).json({ error: 'Wiki client not configured' });
  }

  const applied = [];
  const errors = [];

  for (const p of proposals) {
    try {
      if (p.action === 'create') {
        await wc.createPage(p.slug, p.title, p.proposed_content);
      } else {
        await wc.updatePage(p.pageId, p.proposed_content);
      }
      applied.push({ pageId: p.pageId, title: p.title, slug: p.slug });
    } catch (err) {
      errors.push({ pageId: p.pageId, title: p.title, error: err.message });
    }
  }

  res.json({ applied, errors });
});

// --- Proxy catch-all ---

app.use('/', createProxyMiddleware({
  target: WIKIJS_INTERNAL_URL,
  changeOrigin: true,
  ws: true,
  on: {
    error: (err, req, res) => {
      console.error(`Proxy error for ${req.method} ${req.url}:`, err.message);
      if (!res.headersSent) {
        res.status(502).send('Bad Gateway: unable to reach wiki service');
      }
    },
  },
}));

app.listen(PORT, () => {
  console.log(`Proxy running on port ${PORT}, forwarding to ${WIKIJS_INTERNAL_URL}`);
});
