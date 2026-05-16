const { analyzeNotes } = require('../noteProcessor');

// --- Mock helpers ---

function makeWikiClient(pages, contentMap = {}) {
  return {
    listPages: jest.fn().mockResolvedValue(pages),
    getPage: jest.fn().mockImplementation((id) => {
      const page = contentMap[id];
      if (!page) return Promise.resolve(null);
      return Promise.resolve(page);
    }),
  };
}

function makeAnthropicClient(phase1Response, phase2Response) {
  let callCount = 0;
  return {
    messages: {
      create: jest.fn().mockImplementation(() => {
        callCount += 1;
        const text = callCount === 1 ? phase1Response : phase2Response;
        return Promise.resolve({
          content: [{ type: 'text', text }],
        });
      }),
    },
  };
}

// --- Fixtures ---

const PAGES = [
  { id: 1, path: 'npcs/aria', title: 'Aria the Merchant' },
  { id: 2, path: 'locations/stormhaven', title: 'Stormhaven' },
  { id: 3, path: 'factions/guild', title: 'Merchant Guild' },
];

const CONTENT_MAP = {
  1: { id: 1, path: 'npcs/aria', title: 'Aria the Merchant', content: '# Aria the Merchant\n\nAn elf merchant.' },
  2: { id: 2, path: 'locations/stormhaven', title: 'Stormhaven', content: '# Stormhaven\n\nA coastal city.' },
};

const NOTES = 'The party met Aria the Merchant in Stormhaven. She revealed she is a member of the Merchant Guild.';

// --- Tests ---

describe('analyzeNotes', () => {
  test('returns empty array when no pages are affected', async () => {
    const wikiClient = makeWikiClient(PAGES, CONTENT_MAP);
    const anthropic = makeAnthropicClient(
      JSON.stringify({ affected_page_ids: [] }),
      '{}'
    );

    const result = await analyzeNotes(NOTES, wikiClient, anthropic);

    expect(result).toEqual([]);
    expect(anthropic.messages.create).toHaveBeenCalledTimes(1);
    expect(wikiClient.getPage).not.toHaveBeenCalled();
  });

  test('returns one proposal when one page is affected', async () => {
    const wikiClient = makeWikiClient(PAGES, CONTENT_MAP);
    const phase2Payload = JSON.stringify([
      {
        action: 'update',
        pageId: 1,
        slug: 'npcs/aria',
        title: 'Aria the Merchant',
        current_content: '# Aria the Merchant\n\nAn elf merchant.',
        proposed_content: '# Aria the Merchant\n\nAn elf merchant and member of the Merchant Guild.',
        rationale: 'Notes reveal guild membership.',
      },
    ]);
    const anthropic = makeAnthropicClient(
      JSON.stringify({ affected_page_ids: [1] }),
      phase2Payload
    );

    const result = await analyzeNotes(NOTES, wikiClient, anthropic);

    expect(result).toHaveLength(1);
    expect(result[0].pageId).toBe(1);
    expect(result[0].action).toBe('update');
    expect(result[0].proposed_content).toContain('Merchant Guild');
    expect(result[0].rationale).toBeTruthy();
  });

  test('returns multiple proposals when multiple pages are affected', async () => {
    const wikiClient = makeWikiClient(PAGES, CONTENT_MAP);
    const phase2Payload = JSON.stringify([
      {
        action: 'update',
        pageId: 1,
        slug: 'npcs/aria',
        title: 'Aria the Merchant',
        current_content: '# Aria the Merchant\n\nAn elf merchant.',
        proposed_content: '# Aria the Merchant\n\nAn elf merchant and member of the Merchant Guild.',
        rationale: 'Notes reveal guild membership.',
      },
      {
        action: 'update',
        pageId: 2,
        slug: 'locations/stormhaven',
        title: 'Stormhaven',
        current_content: '# Stormhaven\n\nA coastal city.',
        proposed_content: '# Stormhaven\n\nA coastal city where the party met Aria.',
        rationale: 'Notes place the meeting in Stormhaven.',
      },
    ]);
    const anthropic = makeAnthropicClient(
      JSON.stringify({ affected_page_ids: [1, 2] }),
      phase2Payload
    );

    const result = await analyzeNotes(NOTES, wikiClient, anthropic);

    expect(result).toHaveLength(2);
    expect(wikiClient.getPage).toHaveBeenCalledTimes(2);
    expect(anthropic.messages.create).toHaveBeenCalledTimes(2);
  });

  test('phase 2 is not called when phase 1 returns no affected pages', async () => {
    const wikiClient = makeWikiClient(PAGES, CONTENT_MAP);
    const anthropic = makeAnthropicClient(
      JSON.stringify({ affected_page_ids: [] }),
      'should not be called'
    );

    await analyzeNotes(NOTES, wikiClient, anthropic);

    expect(anthropic.messages.create).toHaveBeenCalledTimes(1);
  });

  test('phase 1 uses cache_control on the page list block', async () => {
    const wikiClient = makeWikiClient(PAGES, CONTENT_MAP);
    const anthropic = makeAnthropicClient(
      JSON.stringify({ affected_page_ids: [] }),
      '{}'
    );

    await analyzeNotes(NOTES, wikiClient, anthropic);

    const phase1Call = anthropic.messages.create.mock.calls[0][0];
    const hasCache = phase1Call.messages.some(
      (m) =>
        Array.isArray(m.content) &&
        m.content.some((block) => block.cache_control?.type === 'ephemeral')
    );
    expect(hasCache).toBe(true);
  });

  test('current_content in proposal matches what wikiClient returned', async () => {
    const wikiClient = makeWikiClient(PAGES, CONTENT_MAP);
    const expectedContent = CONTENT_MAP[1].content;
    const phase2Payload = JSON.stringify([
      {
        action: 'update',
        pageId: 1,
        slug: 'npcs/aria',
        title: 'Aria the Merchant',
        current_content: expectedContent,
        proposed_content: expectedContent + '\n\nNew info.',
        rationale: 'Added new info.',
      },
    ]);
    const anthropic = makeAnthropicClient(
      JSON.stringify({ affected_page_ids: [1] }),
      phase2Payload
    );

    const result = await analyzeNotes(NOTES, wikiClient, anthropic);

    expect(result[0].current_content).toBe(expectedContent);
  });

  test('throws a clear error when phase 1 returns malformed JSON', async () => {
    const wikiClient = makeWikiClient(PAGES, CONTENT_MAP);
    const anthropic = makeAnthropicClient('not json at all', '{}');

    await expect(analyzeNotes(NOTES, wikiClient, anthropic)).rejects.toThrow(
      /phase 1/i
    );
  });

  test('throws a clear error when phase 2 returns malformed JSON', async () => {
    const wikiClient = makeWikiClient(PAGES, CONTENT_MAP);
    const anthropic = makeAnthropicClient(
      JSON.stringify({ affected_page_ids: [1] }),
      'not json at all'
    );

    await expect(analyzeNotes(NOTES, wikiClient, anthropic)).rejects.toThrow(
      /phase 2/i
    );
  });
});
