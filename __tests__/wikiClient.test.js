const WikiClient = require('../wikiClient');

const WIKIJS_URL = process.env.WIKIJS_INTERNAL_URL;
const WIKIJS_TOKEN = process.env.WIKIJS_API_TOKEN;

const describeOrSkip = WIKIJS_URL && WIKIJS_TOKEN ? describe : describe.skip;

describeOrSkip('WikiClient integration tests', () => {
  let client;
  let createdPageId;

  const TEST_PATH = 'test/integration-scratch';
  const TEST_TITLE = 'Integration Test Scratch Page';
  const TEST_CONTENT = '# Scratch Page\n\nCreated by integration tests. Safe to delete.';

  beforeAll(() => {
    client = new WikiClient(WIKIJS_URL, WIKIJS_TOKEN);
  });

  describe('listPages', () => {
    test('returns array of page metadata objects with id, path, and title', async () => {
      const pages = await client.listPages();
      expect(Array.isArray(pages)).toBe(true);
      expect(pages.length).toBeGreaterThan(0);
      const page = pages[0];
      expect(page).toHaveProperty('id');
      expect(page).toHaveProperty('path');
      expect(page).toHaveProperty('title');
    });
  });

  describe('createPage', () => {
    test('creates a new page and returns its ID and title', async () => {
      const page = await client.createPage(TEST_PATH, TEST_TITLE, TEST_CONTENT);
      expect(page).toHaveProperty('id');
      expect(typeof page.id).toBe('number');
      expect(page.title).toBe(TEST_TITLE);
      createdPageId = page.id;
    });
  });

  describe('getPage', () => {
    test('returns full page content by ID', async () => {
      expect(createdPageId).toBeDefined();
      const page = await client.getPage(createdPageId);
      expect(page).toHaveProperty('id', createdPageId);
      expect(page).toHaveProperty('title', TEST_TITLE);
      expect(page).toHaveProperty('content');
      expect(page.content).toContain('Scratch Page');
    });

    test('returns null for non-existent page ID', async () => {
      const page = await client.getPage(999999);
      expect(page).toBeNull();
    });
  });

  describe('updatePage', () => {
    test('modifies an existing page and change is reflected when fetched again', async () => {
      expect(createdPageId).toBeDefined();
      const updatedContent = '# Scratch Page\n\nUPDATED by integration tests.';
      await client.updatePage(createdPageId, updatedContent);

      const page = await client.getPage(createdPageId);
      expect(page.content).toContain('UPDATED by integration tests');
    });
  });
});

describe('WikiClient constructor', () => {
  test('throws if baseUrl is missing', () => {
    expect(() => new WikiClient(null, 'token')).toThrow('baseUrl is required');
  });

  test('throws if apiToken is missing', () => {
    expect(() => new WikiClient('http://example.com', null)).toThrow('apiToken is required');
  });
});

describe('WikiClient updatePage unit', () => {
  const axios = require('axios');

  const existingPage = { id: 5, path: 'npcs/aria', title: 'Aria', content: '# Aria' };

  function mockAxiosPost(responseData) {
    jest.spyOn(axios, 'post').mockResolvedValue({ data: responseData });
  }

  afterEach(() => jest.restoreAllMocks());

  test('uses original path when no newPath is provided', async () => {
    const client = new WikiClient('http://wiki.test', 'tok');
    mockAxiosPost({
      data: { pages: { single: existingPage } },
    });
    mockAxiosPost({
      data: { pages: { update: { responseResult: { succeeded: true }, page: { id: 5, path: 'npcs/aria', title: 'Aria' } } } },
    });
    jest.spyOn(axios, 'post')
      .mockResolvedValueOnce({ data: { data: { pages: { single: existingPage } } } })
      .mockResolvedValueOnce({ data: { data: { pages: { update: { responseResult: { succeeded: true }, page: { id: 5, path: 'npcs/aria', title: 'Aria' } } } } } });

    await client.updatePage(5, 'new content');

    const updateCall = axios.post.mock.calls[1];
    expect(updateCall[1].variables.path).toBe('npcs/aria');
  });

  test('uses newPath in the mutation when provided', async () => {
    const client = new WikiClient('http://wiki.test', 'tok');
    jest.spyOn(axios, 'post')
      .mockResolvedValueOnce({ data: { data: { pages: { single: existingPage } } } })
      .mockResolvedValueOnce({ data: { data: { pages: { update: { responseResult: { succeeded: true }, page: { id: 5, path: 'villains/aria', title: 'Aria' } } } } } });

    await client.updatePage(5, 'new content', 'villains/aria');

    const updateCall = axios.post.mock.calls[1];
    expect(updateCall[1].variables.path).toBe('villains/aria');
  });
});
