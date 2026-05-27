const { analyzeNotes, findExactPageMatches, validatePhase1, validatePhase2 } = require('../noteProcessor');

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

// Minimal valid proposal fixture
function makeProposal(overrides = {}) {
  return {
    action: 'update',
    pageId: 1,
    slug: 'npcs/aria',
    title: 'Aria the Merchant',
    current_content: '# Aria',
    proposed_content: '# Aria\n\nUpdated.',
    rationale: 'New info.',
    ...overrides,
  };
}

// --- analyzeNotes integration tests ---

describe('analyzeNotes', () => {
  test('returns empty array when no pages are affected', async () => {
    const wikiClient = makeWikiClient(PAGES, CONTENT_MAP);
    const anthropic = makeAnthropicClient(
      JSON.stringify({ affected_page_ids: [], has_new_pages: false }),
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
      JSON.stringify({ affected_page_ids: [1], has_new_pages: false }),
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
      JSON.stringify({ affected_page_ids: [1, 2], has_new_pages: false }),
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
      JSON.stringify({ affected_page_ids: [], has_new_pages: false }),
      'should not be called'
    );

    // Use neutral notes so pre-check also returns nothing
    await analyzeNotes(NEUTRAL_NOTES, wikiClient, anthropic);

    expect(anthropic.messages.create).toHaveBeenCalledTimes(1);
  });

  test('phase 1 uses cache_control on the page list block', async () => {
    const wikiClient = makeWikiClient(PAGES, CONTENT_MAP);
    const anthropic = makeAnthropicClient(
      JSON.stringify({ affected_page_ids: [], has_new_pages: false }),
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
      JSON.stringify({ affected_page_ids: [1], has_new_pages: false }),
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
      JSON.stringify({ affected_page_ids: [1], has_new_pages: false }),
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

  // --- Few-shot prompt content ---

  test('phase 1 prompt includes few-shot examples', async () => {
    const wikiClient = makeWikiClient(PAGES, CONTENT_MAP);
    const anthropic = makeAnthropicClient(
      JSON.stringify({ affected_page_ids: [], has_new_pages: false }),
      '{}'
    );
    await analyzeNotes(NEUTRAL_NOTES, wikiClient, anthropic);

    const phase1Call = anthropic.messages.create.mock.calls[0][0];
    const allText = phase1Call.messages
      .flatMap((m) => (Array.isArray(m.content) ? m.content.map((b) => b.text) : [m.content]))
      .join('\n');

    expect(allText).toMatch(/Example A/);
    expect(allText).toMatch(/Example B/);
    expect(allText).toMatch(/Example C/);
    expect(allText).toMatch(/"has_new_pages": false/);
    expect(allText).toMatch(/"has_new_pages": true/);
  });

  test('phase 2 prompt includes few-shot example with both update and create', async () => {
    const wikiClient = makeWikiClient(PAGES, CONTENT_MAP);
    const phase2Payload = JSON.stringify([
      makeProposal({ pageId: 1, slug: 'npcs/aria', title: 'Aria the Merchant',
        current_content: CONTENT_MAP[1].content, proposed_content: CONTENT_MAP[1].content + '\n\nNew info.' }),
    ]);
    const anthropic = makeAnthropicClient(
      JSON.stringify({ affected_page_ids: [1], has_new_pages: false }),
      phase2Payload
    );
    await analyzeNotes(NOTES, wikiClient, anthropic);

    const phase2Call = anthropic.messages.create.mock.calls[1][0];
    const prompt = typeof phase2Call.messages[0].content === 'string'
      ? phase2Call.messages[0].content
      : phase2Call.messages[0].content.map((b) => b.text).join('\n');

    expect(prompt).toMatch(/"action": "update"/);
    expect(prompt).toMatch(/"action": "create"/);
    expect(prompt).toMatch(/"pageId": null/);
  });

  // --- Phase 1 validation (via analyzeNotes) ---

  test('throws when phase 1 response is missing affected_page_ids', async () => {
    const wikiClient = makeWikiClient(PAGES, CONTENT_MAP);
    const anthropic = makeAnthropicClient(
      JSON.stringify({ has_new_pages: false }),
      '{}'
    );
    await expect(analyzeNotes(NEUTRAL_NOTES, wikiClient, anthropic)).rejects.toThrow(
      /affected_page_ids/
    );
  });

  test('throws when phase 1 affected_page_ids is not an array', async () => {
    const wikiClient = makeWikiClient(PAGES, CONTENT_MAP);
    const anthropic = makeAnthropicClient(
      JSON.stringify({ affected_page_ids: 'oops', has_new_pages: false }),
      '{}'
    );
    await expect(analyzeNotes(NEUTRAL_NOTES, wikiClient, anthropic)).rejects.toThrow(
      /affected_page_ids.*array/i
    );
  });

  test('throws when phase 1 affected_page_ids contains non-integers', async () => {
    const wikiClient = makeWikiClient(PAGES, CONTENT_MAP);
    const anthropic = makeAnthropicClient(
      JSON.stringify({ affected_page_ids: ['1', '2'], has_new_pages: false }),
      '{}'
    );
    await expect(analyzeNotes(NEUTRAL_NOTES, wikiClient, anthropic)).rejects.toThrow(
      /integers/i
    );
  });

  test('throws when phase 1 response is missing has_new_pages', async () => {
    const wikiClient = makeWikiClient(PAGES, CONTENT_MAP);
    const anthropic = makeAnthropicClient(
      JSON.stringify({ affected_page_ids: [] }),
      '{}'
    );
    await expect(analyzeNotes(NEUTRAL_NOTES, wikiClient, anthropic)).rejects.toThrow(
      /has_new_pages/
    );
  });

  test('throws when phase 1 has_new_pages is not a boolean', async () => {
    const wikiClient = makeWikiClient(PAGES, CONTENT_MAP);
    const anthropic = makeAnthropicClient(
      JSON.stringify({ affected_page_ids: [], has_new_pages: 'yes' }),
      '{}'
    );
    await expect(analyzeNotes(NEUTRAL_NOTES, wikiClient, anthropic)).rejects.toThrow(
      /has_new_pages.*boolean/i
    );
  });

  // --- Phase 2 validation (via analyzeNotes) ---

  test('throws when a phase 2 proposal is missing a required field', async () => {
    const wikiClient = makeWikiClient(PAGES, CONTENT_MAP);
    const badProposal = { action: 'update', pageId: 1, slug: 'npcs/aria', title: 'Aria the Merchant',
      current_content: '# Aria', proposed_content: '# Aria\n\nUpdated.' /* missing rationale */ };
    const anthropic = makeAnthropicClient(
      JSON.stringify({ affected_page_ids: [1], has_new_pages: false }),
      JSON.stringify([badProposal])
    );
    await expect(analyzeNotes(NOTES, wikiClient, anthropic)).rejects.toThrow(
      /rationale/
    );
  });

  test('throws when a phase 2 proposal has an invalid action', async () => {
    const wikiClient = makeWikiClient(PAGES, CONTENT_MAP);
    const anthropic = makeAnthropicClient(
      JSON.stringify({ affected_page_ids: [1], has_new_pages: false }),
      JSON.stringify([makeProposal({ action: 'delete' })])
    );
    await expect(analyzeNotes(NOTES, wikiClient, anthropic)).rejects.toThrow(
      /action.*update.*create|update.*create.*action/i
    );
  });

  test('throws when a phase 2 string field is not a string', async () => {
    const wikiClient = makeWikiClient(PAGES, CONTENT_MAP);
    const anthropic = makeAnthropicClient(
      JSON.stringify({ affected_page_ids: [1], has_new_pages: false }),
      JSON.stringify([makeProposal({ rationale: 42 })])
    );
    await expect(analyzeNotes(NOTES, wikiClient, anthropic)).rejects.toThrow(
      /rationale.*string|string.*rationale/i
    );
  });

  test('throws when a phase 2 pageId is neither a number nor null', async () => {
    const wikiClient = makeWikiClient(PAGES, CONTENT_MAP);
    const anthropic = makeAnthropicClient(
      JSON.stringify({ affected_page_ids: [1], has_new_pages: false }),
      JSON.stringify([makeProposal({ pageId: 'npcs/aria' })])
    );
    await expect(analyzeNotes(NOTES, wikiClient, anthropic)).rejects.toThrow(
      /pageId.*integer.*null|integer.*null.*pageId/i
    );
  });
});

// --- validatePhase1 unit tests ---

describe('validatePhase1', () => {
  const raw = 'raw text';

  test('accepts valid data', () => {
    expect(() => validatePhase1({ affected_page_ids: [1, 2], has_new_pages: true }, raw)).not.toThrow();
    expect(() => validatePhase1({ affected_page_ids: [], has_new_pages: false }, raw)).not.toThrow();
  });

  test('throws when affected_page_ids is missing', () => {
    expect(() => validatePhase1({ has_new_pages: false }, raw)).toThrow(/affected_page_ids/);
  });

  test('throws when affected_page_ids is not an array', () => {
    expect(() => validatePhase1({ affected_page_ids: 1, has_new_pages: false }, raw)).toThrow(/array/i);
  });

  test('throws when affected_page_ids contains a string', () => {
    expect(() => validatePhase1({ affected_page_ids: ['1'], has_new_pages: false }, raw)).toThrow(/integers/i);
  });

  test('throws when affected_page_ids contains a float', () => {
    expect(() => validatePhase1({ affected_page_ids: [1.5], has_new_pages: false }, raw)).toThrow(/integers/i);
  });

  test('throws when has_new_pages is missing', () => {
    expect(() => validatePhase1({ affected_page_ids: [] }, raw)).toThrow(/has_new_pages/);
  });

  test('throws when has_new_pages is not a boolean', () => {
    expect(() => validatePhase1({ affected_page_ids: [], has_new_pages: 1 }, raw)).toThrow(/boolean/i);
  });
});

// --- validatePhase2 unit tests ---

describe('validatePhase2', () => {
  const raw = 'raw text';

  test('accepts a valid update proposal', () => {
    expect(() => validatePhase2([makeProposal()], raw)).not.toThrow();
  });

  test('accepts a valid create proposal', () => {
    expect(() =>
      validatePhase2([makeProposal({ action: 'create', pageId: null, current_content: '' })], raw)
    ).not.toThrow();
  });

  test('accepts an empty array', () => {
    expect(() => validatePhase2([], raw)).not.toThrow();
  });

  test('throws when response is not an array', () => {
    expect(() => validatePhase2({}, raw)).toThrow(/array/i);
  });

  REQUIRED_PROPOSAL_FIELDS_FOR_TEST = [
    'action', 'pageId', 'slug', 'title', 'current_content', 'proposed_content', 'rationale',
  ];

  for (const field of ['action', 'pageId', 'slug', 'title', 'current_content', 'proposed_content', 'rationale']) {
    test(`throws when proposal is missing field "${field}"`, () => {
      const proposal = makeProposal();
      delete proposal[field];
      expect(() => validatePhase2([proposal], raw)).toThrow(new RegExp(field));
    });
  }

  test('throws when action is not "update" or "create"', () => {
    expect(() => validatePhase2([makeProposal({ action: 'patch' })], raw)).toThrow(/action/i);
  });

  test('throws when a string field is not a string', () => {
    expect(() => validatePhase2([makeProposal({ slug: 123 })], raw)).toThrow(/slug.*string|string.*slug/i);
    expect(() => validatePhase2([makeProposal({ rationale: null })], raw)).toThrow(/rationale.*string|string.*rationale/i);
  });

  test('throws when pageId is not a number or null', () => {
    expect(() => validatePhase2([makeProposal({ pageId: 'npcs/aria' })], raw)).toThrow(/pageId/i);
  });

  test('accepts pageId as null for an update (defensive — allows null if page lookup fails gracefully)', () => {
    expect(() => validatePhase2([makeProposal({ pageId: null })], raw)).not.toThrow();
  });
});

// --- findExactPageMatches unit tests ---

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
