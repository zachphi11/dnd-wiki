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

/**
 * Deterministically find pages whose title appears as a whole word in the notes.
 * Case-insensitive. Whole-word boundary match prevents "Tor" matching "Tordek".
 *
 * @param {string} notes - Raw session notes text.
 * @param {Array<{id: number, title: string}>} pages - Full page list from the wiki.
 * @returns {number[]} Array of page IDs whose titles appear in the notes.
 */
function findExactPageMatches(notes, pages) {
  return pages
    .filter(({ title }) => {
      const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`\\b${escaped}\\b`, 'i');
      return re.test(notes);
    })
    .map(({ id }) => id);
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
            text: `Session notes (may be formatted as Markdown — headings and bullet points indicate distinct topics and entities):\n\n${notes}\n\nFollow these steps:\n1. Identify every proper noun in the notes — named characters, locations, organizations, and items.\n2. For each proper noun, check whether it matches an existing page in the list above.\n3. Return JSON with two fields:\n   - "affected_page_ids": IDs of existing pages that correspond to proper nouns found in the notes (include a page even if the entity is only mentioned in passing)\n   - "has_new_pages": true if any proper nouns were found that do not correspond to any existing page, false otherwise\n\nExample: {"affected_page_ids": [1, 2], "has_new_pages": true}`,
          },
        ],
      },
    ],
  });

  const phase1Text = phase1.content[0].text;
  const { affected_page_ids: claudeIds, has_new_pages: hasNewPages } = parseJSON(phase1Text, 1);

  // Merge deterministic pre-check IDs with Claude's Phase 1 IDs (deduplicated)
  const preMatchedIds = findExactPageMatches(notes, pages);
  const mergedIds = [...new Set([...preMatchedIds, ...(Array.isArray(claudeIds) ? claudeIds : [])])];

  const hasUpdates = mergedIds.length > 0;
  if (!hasUpdates && !hasNewPages) {
    return [];
  }

  // Phase 2: fetch affected page content and generate proposals
  const ids = mergedIds;
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
        content: `Session notes (may be formatted as Markdown — headings and bullet points indicate distinct topics and entities):\n\n${notes}\n\nCurrent content of affected pages:\n\n${pageContext}${existingPagesNote}\n\nReturn a JSON array of proposed changes. Each item must have: action ("update" or "create"), pageId (null for new pages), slug (string), title (string), current_content (string, empty for new pages), proposed_content (string), rationale (string). Do not propose creating a new page for any entity whose page content is already provided in the context above — always use the existing page instead.`,
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

module.exports = { analyzeNotes, findExactPageMatches };
