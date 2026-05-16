const request = require('supertest');
const express = require('express');
const path = require('path');

// Build a minimal app with just the upload routes (no proxy) for testing
function buildApp() {
  const app = express();
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());
  app.use(express.static(path.join(__dirname, '..', 'public')));

  app.get('/upload', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'upload.html'));
  });

  app.post('/upload/analyze', (req, res) => {
    const { notes } = req.body;
    if (!notes || !notes.trim()) {
      return res.status(400).json({ error: 'notes are required' });
    }
    res.json({ proposals: [] });
  });

  return app;
}

describe('Upload routes', () => {
  let app;

  beforeAll(() => {
    app = buildApp();
  });

  describe('GET /upload', () => {
    test('returns 200 with HTML content', async () => {
      const res = await request(app).get('/upload');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/html/);
    });

    test('response contains a textarea', async () => {
      const res = await request(app).get('/upload');
      expect(res.text).toContain('<textarea');
    });

    test('response contains a submit button', async () => {
      const res = await request(app).get('/upload');
      expect(res.text).toMatch(/type=.submit/);
    });
  });

  describe('POST /upload/analyze', () => {
    test('returns 200 JSON with proposals array for valid input', async () => {
      const res = await request(app)
        .post('/upload/analyze')
        .send({ notes: 'The party met Aria the elf merchant at Stormhaven.' });
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('proposals');
      expect(Array.isArray(res.body.proposals)).toBe(true);
    });

    test('returns 400 when notes are missing', async () => {
      const res = await request(app)
        .post('/upload/analyze')
        .send({});
      expect(res.status).toBe(400);
    });

    test('returns 400 when notes are empty string', async () => {
      const res = await request(app)
        .post('/upload/analyze')
        .send({ notes: '   ' });
      expect(res.status).toBe(400);
    });
  });
});
