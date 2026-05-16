const SYSTEM_PROMPT = `You are an assistant helping maintain a D&D campaign wiki.
The wiki contains pages for NPCs, locations, factions, items, and session history.
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
            text: `Session notes:\n\n${notes}\n\nReturn JSON with the IDs of pages that need updating: {"affected_page_ids": [1, 2, ...]}. Return an empty array if no pages are affected.`,
          },
        ],
      },
    ],
  });

  const phase1Text = phase1.content[0].text;
  const { affected_page_ids: affectedIds } = parseJSON(phase1Text, 1);

  if (!Array.isArray(affectedIds) || affectedIds.length === 0) {
    return [];
  }

  // Phase 2: fetch affected page content and generate proposals
  const affectedPages = await Promise.all(affectedIds.map((id) => wikiClient.getPage(id)));
  const pageContext = affectedPages
    .filter(Boolean)
    .map((p) => `--- Page ID ${p.id}: "${p.title}" ---\n${p.content}`)
    .join('\n\n');

  const phase2 = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: `Session notes:\n\n${notes}\n\nCurrent content of affected pages:\n\n${pageContext}\n\nReturn a JSON array of proposed changes. Each item must have: action ("update" or "create"), pageId (number), slug (string), title (string), current_content (string), proposed_content (string), rationale (string).`,
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
