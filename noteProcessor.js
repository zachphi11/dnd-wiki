const SYSTEM_PROMPT = `You are an assistant helping maintain a D&D campaign wiki.
The wiki contains pages for player characters, NPCs, locations, factions, items, and session history.
When analyzing session notes, you must:
- Only propose changes that are directly supported by the notes.
- Preserve all existing wiki content that the notes do not contradict.
- Never speculate beyond what is stated in the notes.
- Return valid JSON only — no prose, no markdown fences.`;

function buildPageListText(pages) {
  return pages.map((p) => `ID ${p.id}: "${p.title}" (${p.path})`).join('\n');
}

function parseJSON(text, phase) {
  try {
    const stripped = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    return JSON.parse(stripped);
  } catch {
    throw new Error(`Phase ${phase} returned invalid JSON: ${text.slice(0, 120)}`);
  }
}

/**
 * Two-phase Claude analysis of D&D session notes.
 *
 * @param {string} notes - Raw session notes text.
 * @param {object} wikiClient - WikiClient instance (listPages, getPage).
 * @param {object} anthropic - Anthropic SDK client instance.
 * @returns {Promise<Array>} proposals — each shaped as
 *   { action, pageId, slug, title, current_content, proposed_content, rationale }
 */
async function analyzeNotes(notes, wikiClient, anthropic) {
  const pages = await wikiClient.listPages();
  const pageListText = buildPageListText(pages);

  // Phase 1: identify affected pages — cache the stable page list block
  const phase1 = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 512,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `Here is the full list of wiki pages:\n\n${pageListText}`,
            cache_control: { type: 'ephemeral' },
          },
          {
            type: 'text',
            text: `Session notes (may be formatted as Markdown — headings and bullet points indicate distinct topics and entities):\n\n${notes}\n\nReturn JSON with two fields:\n- "affected_page_ids": IDs of existing pages that need updating (empty array if none)\n- "has_new_pages": true if the notes introduce any new entities (characters, locations, items, factions, etc.) that do not have an existing page yet, false otherwise\n\nExample: {"affected_page_ids": [1, 2], "has_new_pages": false}`,
          },
        ],
      },
    ],
  });

  const phase1Text = phase1.content[0].text;
  const { affected_page_ids: affectedIds, has_new_pages: hasNewPages } = parseJSON(phase1Text, 1);

  const hasUpdates = Array.isArray(affectedIds) && affectedIds.length > 0;
  if (!hasUpdates && !hasNewPages) {
    return [];
  }

  // Phase 2: fetch affected page content and generate proposals
  const ids = Array.isArray(affectedIds) ? affectedIds : [];
  const affectedPages = await Promise.all(ids.map((id) => wikiClient.getPage(id)));
  const pageContext = affectedPages
    .filter(Boolean)
    .map((p) => `--- Page ID ${p.id}: "${p.title}" ---\n${p.content}`)
    .join('\n\n');

  const existingPagesNote = hasNewPages
    ? `\n\nExisting wiki pages (use this list to pick non-colliding slugs for new pages):\n${pageListText}`
    : '';

  const phase2 = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: `Session notes (may be formatted as Markdown — headings and bullet points indicate distinct topics and entities):\n\n${notes}\n\nCurrent content of affected pages:\n\n${pageContext}${existingPagesNote}\n\nReturn a JSON array of proposed changes. Each item must have: action ("update" or "create"), pageId (null for new pages), slug (string), title (string), current_content (string, empty for new pages), proposed_content (string), rationale (string).`,
      },
    ],
  });

  const phase2Text = phase2.content[0].text;
  const proposals = parseJSON(phase2Text, 2);

  if (!Array.isArray(proposals)) {
    throw new Error(`Phase 2 response is not an array: ${phase2Text.slice(0, 120)}`);
  }

  return proposals;
}

module.exports = { analyzeNotes };
