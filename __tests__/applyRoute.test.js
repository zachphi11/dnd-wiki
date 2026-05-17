const request = require('supertest');
const express = require('express');
const path = require('path');

// Build an isolated app with just the apply route for testing
function buildApp(wikiClientOverride) {
  const app = express();
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());
  app.use(express.static(path.join(__dirname, '..', 'public')));

  // Inject wikiClient via app.locals so the route can reach it
  app.locals.wikiClient = wikiClientOverride;

  app.post('/upload/apply', async (req, res) => {
    const { proposals } = req.body;
    if (!Array.isArray(proposals) || proposals.length === 0) {
      return res.status(400).json({ error: 'proposals array is required' });
    }

    const wikiClient = req.app.locals.wikiClient;
    const applied = [];
    const errors = [];

    for (const p of proposals) {
      try {
        if (p.action === 'create') {
          await wikiClient.createPage(p.slug, p.title, p.proposed_content);
        } else {
          await wikiClient.updatePage(p.pageId, p.proposed_content, p.slug || null);
        }
        applied.push({ pageId: p.pageId, title: p.title, slug: p.slug });
      } catch (err) {
        errors.push({ pageId: p.pageId, title: p.title, error: err.message });
      }
    }

    res.json({ applied, errors });
  });

  return app;
}

describe('POST /upload/apply', () => {
  test('returns 400 when proposals are missing', async () => {
    const app = buildApp({});
    const res = await request(app).post('/upload/apply').send({});
    expect(res.status).toBe(400);
  });

  test('returns 400 when proposals is an empty array', async () => {
    const app = buildApp({});
    const res = await request(app).post('/upload/apply').send({ proposals: [] });
    expect(res.status).toBe(400);
  });

  test('calls updatePage for update proposals and returns applied list', async () => {
    const mockWiki = {
      updatePage: jest.fn().mockResolvedValue({ id: 1 }),
      createPage: jest.fn(),
    };
    const app = buildApp(mockWiki);

    const res = await request(app)
      .post('/upload/apply')
      .send({
        proposals: [
          {
            action: 'update',
            pageId: 1,
            slug: 'npcs/aria',
            title: 'Aria',
            proposed_content: '# Aria\n\nUpdated.',
          },
        ],
      });

    expect(res.status).toBe(200);
    expect(mockWiki.updatePage).toHaveBeenCalledWith(1, '# Aria\n\nUpdated.', 'npcs/aria');
    expect(res.body.applied).toHaveLength(1);
    expect(res.body.applied[0].title).toBe('Aria');
    expect(res.body.errors).toHaveLength(0);
  });

  test('calls createPage for create proposals', async () => {
    const mockWiki = {
      updatePage: jest.fn(),
      createPage: jest.fn().mockResolvedValue({ id: 99 }),
    };
    const app = buildApp(mockWiki);

    const res = await request(app)
      .post('/upload/apply')
      .send({
        proposals: [
          {
            action: 'create',
            pageId: null,
            slug: 'npcs/new-npc',
            title: 'New NPC',
            proposed_content: '# New NPC\n\nIntroduced this session.',
          },
        ],
      });

    expect(res.status).toBe(200);
    expect(mockWiki.createPage).toHaveBeenCalledWith('npcs/new-npc', 'New NPC', '# New NPC\n\nIntroduced this session.');
    expect(res.body.applied).toHaveLength(1);
  });

  test('records errors but continues applying remaining proposals', async () => {
    const mockWiki = {
      updatePage: jest.fn()
        .mockRejectedValueOnce(new Error('wiki unreachable'))
        .mockResolvedValueOnce({ id: 2 }),
      createPage: jest.fn(),
    };
    const app = buildApp(mockWiki);

    const res = await request(app)
      .post('/upload/apply')
      .send({
        proposals: [
          { action: 'update', pageId: 1, slug: 'npcs/aria', title: 'Aria', proposed_content: 'A' },
          { action: 'update', pageId: 2, slug: 'locations/city', title: 'City', proposed_content: 'B' },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.applied).toHaveLength(1);
    expect(res.body.errors).toHaveLength(1);
    expect(res.body.errors[0].error).toContain('wiki unreachable');
  });
});
