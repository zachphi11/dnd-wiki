const { analyzeNotes, findExactPageMatches } = require('../noteProcessor');

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

// Notes that don't match any existing page titles — for testing "no affected pages" paths
const NEUTRAL_NOTES = 'The party delved into a dungeon filled with ancient traps and found treasure.';

// --- Tests ---

describe('analyzeNotes', () => {
  test('returns empty array when no pages are affected', async () => {
    const wikiClient = makeWikiClient(PAGES, CONTENT_MAP);
    const anthropic = makeAnthropicClient(
      JSON.stringify({ affected_page_ids: [] }),
      '{}'
    );

    // Use neutral notes that don't match any page titles so the pre-check returns nothing
    const result = await analyzeNotes(NEUTRAL_NOTES, wikiClient, anthropic);

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
    // Pre-check also finds "Merchant Guild" (id 3) in NOTES, so getPage is called 3 times total
    expect(wikiClient.getPage).toHaveBeenCalledTimes(3);
    expect(anthropic.messages.create).toHaveBeenCalledTimes(2);
  });

  test('phase 2 is not called when phase 1 returns no affected pages and pre-check finds no matches', async () => {
    const wikiClient = makeWikiClient(PAGES, CONTENT_MAP);
    const anthropic = makeAnthropicClient(
      JSON.stringify({ affected_page_ids: [] }),
      'should not be called'
    );

    // Use neutral notes so pre-check also returns nothing
    await analyzeNotes(NEUTRAL_NOTES, wikiClient, anthropic);

    expect(anthropic.messages.create).toHaveBeenCalledTimes(1);
  });

  test('phase 1 uses cache_control on the page list block', async () => {
    const wikiClient = makeWikiClient(PAGES, CONTENT_MAP);
    const anthropic = makeAnthropicClient(
      JSON.stringify({ affected_page_ids: [] }),
      '{}'
    );

    // Use neutral notes so pre-check finds nothing and phase 2 is not reached
    await analyzeNotes(NEUTRAL_NOTES, wikiClient, anthropic);

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

  test('pre-check loads a page even when phase 1 misses it', async () => {
    const wikiClient = makeWikiClient(PAGES, CONTENT_MAP);
    const phase2Payload = JSON.stringify([
      {
        action: 'update',
        pageId: 1,
        slug: 'npcs/aria',
        title: 'Aria the Merchant',
        current_content: CONTENT_MAP[1].content,
        proposed_content: CONTENT_MAP[1].content + '\n\nNew info.',
        rationale: 'New detail from notes.',
      },
    ]);
    // Phase 1 returns nothing — simulating the Alfonso-style miss
    const anthropic = makeAnthropicClient(
      JSON.stringify({ affected_page_ids: [], has_new_pages: false }),
      phase2Payload
    );

    // Notes mention "Aria the Merchant" exactly — pre-check should catch it
    const notes = 'The party spoke with Aria the Merchant about the smugglers.';
    const result = await analyzeNotes(notes, wikiClient, anthropic);

    expect(result).toHaveLength(1);
    expect(result[0].pageId).toBe(1);
    expect(result[0].action).toBe('update');
    // Both phases must have run
    expect(anthropic.messages.create).toHaveBeenCalledTimes(2);
    expect(wikiClient.getPage).toHaveBeenCalledWith(1);
  });

  test('pre-check deduplicates IDs already returned by phase 1', async () => {
    const wikiClient = makeWikiClient(PAGES, CONTENT_MAP);
    const phase2Payload = JSON.stringify([
      {
        action: 'update',
        pageId: 2,
        slug: 'locations/stormhaven',
        title: 'Stormhaven',
        current_content: CONTENT_MAP[2].content,
        proposed_content: CONTENT_MAP[2].content + '\n\nNew detail.',
        rationale: 'Party returned to Stormhaven.',
      },
    ]);
    // Phase 1 also returns id 2
    const anthropic = makeAnthropicClient(
      JSON.stringify({ affected_page_ids: [2], has_new_pages: false }),
      phase2Payload
    );

    const notes = 'The party returned to Stormhaven after a long journey.';
    await analyzeNotes(notes, wikiClient, anthropic);

    // getPage should only be called once for id 2, not twice
    expect(wikiClient.getPage).toHaveBeenCalledTimes(1);
    expect(wikiClient.getPage).toHaveBeenCalledWith(2);
  });
});

describe('findExactPageMatches', () => {
  const pages = [
    { id: 1, title: 'Alfonso' },
    { id: 2, title: 'Stormhaven' },
    { id: 3, title: 'Tor' },
    { id: 4, title: 'Merchant Guild' },
  ];

  test('returns ID for exact title match', () => {
    expect(findExactPageMatches('The party met Alfonso today.', pages)).toEqual([1]);
  });

  test('is case-insensitive', () => {
    expect(findExactPageMatches('ALFONSO arrived at the tavern.', pages)).toEqual([1]);
    expect(findExactPageMatches('alfonso snuck away.', pages)).toEqual([1]);
  });

  test('matches multi-word titles', () => {
    expect(findExactPageMatches('They joined the Merchant Guild last night.', pages)).toEqual([4]);
  });

  test('does not match a title as a substring of a longer word', () => {
    // "Tor" should NOT match inside "Tordek" or "Torchbearer"
    const result = findExactPageMatches('Tordek the dwarf lit a Torchbearer torch.', pages);
    expect(result).not.toContain(3);
  });

  test('matches "Tor" when it appears as a standalone word', () => {
    expect(findExactPageMatches('Tor stood at the gate.', pages)).toContain(3);
  });

  test('returns multiple IDs when multiple titles appear', () => {
    const result = findExactPageMatches('Alfonso and Stormhaven are connected.', pages);
    expect(result).toEqual(expect.arrayContaining([1, 2]));
    expect(result).toHaveLength(2);
  });

  test('returns empty array when no titles match', () => {
    expect(findExactPageMatches('The party found a mysterious artifact.', pages)).toEqual([]);
  });
});
