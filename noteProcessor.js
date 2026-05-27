const SYSTEM_PROMPT = `You are an assistant helping maintain a D&D campaign wiki.
The wiki contains pages for player characters, NPCs, locations, factions, items, and session history.
When analyzing session notes, you must:
- Only propose changes that are directly supported by the notes.
- Preserve all existing wiki content that the notes do not contradict.
- Never speculate beyond what is stated in the notes.
- Return valid JSON only — no prose, no markdown fences, no explanation.`;

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

    // Try direct parse first
    try {
      return JSON.parse(stripped);
    } catch {
      // Model may have included extra text (e.g. "Reasoning: ...") before or after the JSON.
      // Extract the first JSON object or array using a greedy match.
      const match = stripped.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
      if (match) return JSON.parse(match[1]);
      throw new Error('no JSON found');
    }
  } catch {
    throw new Error(`Phase ${phase} returned invalid JSON: ${text.slice(0, 120)}`);
  }
}

/**
 * Validate the Phase 1 response structure.
 * Throws a descriptive error on any violation.
 *
 * @param {object} data - Parsed Phase 1 response.
 * @param {string} rawText - Raw model output (for error context).
 */
function validatePhase1(data, rawText) {
  if (!Array.isArray(data.affected_page_ids)) {
    throw new Error(
      `Phase 1: "affected_page_ids" must be an array, got ${JSON.stringify(data.affected_page_ids)}. Raw: ${rawText.slice(0, 120)}`
    );
  }
  const badId = data.affected_page_ids.find((id) => typeof id !== 'number' || !Number.isInteger(id));
  if (badId !== undefined) {
    throw new Error(
      `Phase 1: "affected_page_ids" must contain only integers, got ${JSON.stringify(badId)}. Raw: ${rawText.slice(0, 120)}`
    );
  }
  if (typeof data.has_new_pages !== 'boolean') {
    throw new Error(
      `Phase 1: "has_new_pages" must be a boolean, got ${JSON.stringify(data.has_new_pages)}. Raw: ${rawText.slice(0, 120)}`
    );
  }
}

const REQUIRED_PROPOSAL_FIELDS = [
  'action', 'pageId', 'slug', 'title', 'current_content', 'proposed_content', 'rationale',
];
const VALID_ACTIONS = ['update', 'create'];
const REQUIRED_STRING_FIELDS = ['slug', 'title', 'current_content', 'proposed_content', 'rationale'];

/**
 * Validate the Phase 2 response structure.
 * Throws a descriptive error on any violation.
 *
 * @param {Array} proposals - Parsed Phase 2 response.
 * @param {string} rawText - Raw model output (for error context).
 */
function validatePhase2(proposals, rawText) {
  if (!Array.isArray(proposals)) {
    throw new Error(`Phase 2 response is not an array. Raw: ${rawText.slice(0, 120)}`);
  }
  for (let i = 0; i < proposals.length; i++) {
    const item = proposals[i];
    for (const field of REQUIRED_PROPOSAL_FIELDS) {
      if (!(field in item)) {
        throw new Error(
          `Phase 2 proposal[${i}] is missing required field "${field}". Raw: ${rawText.slice(0, 120)}`
        );
      }
    }
    if (!VALID_ACTIONS.includes(item.action)) {
      throw new Error(
        `Phase 2 proposal[${i}].action must be "update" or "create", got ${JSON.stringify(item.action)}.`
      );
    }
    for (const field of REQUIRED_STRING_FIELDS) {
      if (typeof item[field] !== 'string') {
        throw new Error(
          `Phase 2 proposal[${i}].${field} must be a string, got ${typeof item[field]}.`
        );
      }
    }
    if (item.pageId !== null && typeof item.pageId !== 'number') {
      throw new Error(
        `Phase 2 proposal[${i}].pageId must be an integer or null, got ${JSON.stringify(item.pageId)}.`
      );
    }
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

  const phase1UserPrompt = `Session notes (may be formatted as Markdown — headings and bullet points indicate distinct topics and entities):

${notes}

Follow these steps:
1. Identify every proper noun in the notes — named characters, locations, organizations, and items.
2. For each proper noun, check whether it matches an existing page in the list above.
3. Return a JSON object with exactly two fields:
   - "affected_page_ids": array of integer IDs of existing pages that match proper nouns in the notes (include even passing mentions)
   - "has_new_pages": boolean — true if any proper noun has no matching page, false otherwise

Examples of correct responses:

Example A — all proper nouns match existing pages:
Notes: "Thorin gave the party a map and pointed toward Darkstone Keep."
Pages: ID 1: "Thorin" | ID 2: "Darkstone Keep"
Response: {"affected_page_ids": [1, 2], "has_new_pages": false}

Example B — one proper noun is new:
Notes: "The party met a wizard named Valdris near The Tavern."
Pages: ID 3: "The Tavern"
Response: {"affected_page_ids": [3], "has_new_pages": true}

Example C — no proper nouns match any existing page:
Notes: "A dragon attacked the village of Ashford."
Pages: (none matching)
Response: {"affected_page_ids": [], "has_new_pages": true}

Return only valid JSON for the notes above — no explanation, no prose.`;

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
            text: phase1UserPrompt,
          },
        ],
      },
    ],
  });

  const phase1Text = phase1.content[0].text;
  const phase1Data = parseJSON(phase1Text, 1);
  validatePhase1(phase1Data, phase1Text);
  const { affected_page_ids: claudeIds, has_new_pages: hasNewPages } = phase1Data;

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
  const affectedPagesFiltered = affectedPages.filter(Boolean);
  const pageById = Object.fromEntries(affectedPagesFiltered.map((p) => [String(p.id), p]));

  const pageContext = affectedPagesFiltered
    .map((p) => `--- Page ID ${p.id}: "${p.title}" (path: ${p.path}) ---\n${p.content}`)
    .join('\n\n');

  const existingPagesNote = hasNewPages
    ? `\n\nExisting wiki pages (use this list to pick non-colliding slugs for new pages):\n${pageListText}`
    : '';

  const phase2Prompt = `Session notes (may be formatted as Markdown — headings and bullet points indicate distinct topics and entities):

${notes}

Current content of affected pages:

${pageContext}${existingPagesNote}

Return a JSON array of proposed changes. Each item must have exactly these fields:
- "action": "update" or "create"
- "pageId": integer ID for updates, null for new pages
- "slug": string path for the page
- "title": string page title
- "current_content": string (empty string for new pages)
- "proposed_content": string with the full updated or new page content
- "rationale": string explaining the change

Do not propose creating a new page for any entity whose page content is already provided above — always update the existing page instead.

Example of a correct response:
[
  {
    "action": "update",
    "pageId": 3,
    "slug": "locations/tavern",
    "title": "The Tavern",
    "current_content": "# The Tavern\\n\\nA local gathering spot.",
    "proposed_content": "# The Tavern\\n\\nA local gathering spot where the party first met Valdris.",
    "rationale": "Notes state the party encountered Valdris near The Tavern."
  },
  {
    "action": "create",
    "pageId": null,
    "slug": "npcs/valdris",
    "title": "Valdris",
    "current_content": "",
    "proposed_content": "# Valdris\\n\\nA wizard encountered by the party near The Tavern.",
    "rationale": "Notes introduce Valdris as a new NPC with no existing page."
  }
]

Return only valid JSON — no prose, no markdown fences.`;

  const phase2 = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: phase2Prompt,
      },
    ],
  });

  const phase2Text = phase2.content[0].text;
  const proposals = parseJSON(phase2Text, 2);
  validatePhase2(proposals, phase2Text);

  // For update proposals, always use the actual page path from the wiki — never trust
  // Claude's slug guess, which won't include subdirectory prefixes like "players/".
  return proposals.map((proposal) => {
    if (proposal.action === 'update' && proposal.pageId != null) {
      const page = pageById[String(proposal.pageId)];
      if (page?.path) {
        return { ...proposal, slug: page.path };
      }
    }
    return proposal;
  });
}

module.exports = { analyzeNotes, findExactPageMatches, validatePhase1, validatePhase2 };
