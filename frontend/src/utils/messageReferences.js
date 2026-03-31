/**
 * @typedef {{
 *   title: string;
 *   excerpt: string;
 *   category: string;
 *   path: string;
 *   score?: number;
 * }} KnowledgeHit
 */

/**
 * @typedef {{
 *   role: 'user' | 'assistant';
 *   content: string;
 *   knowledgeHits?: KnowledgeHit[];
 * }} ChatMessage
 */

/**
 * @param {unknown} rawHits
 * @returns {KnowledgeHit[]}
 */
export function normalizeKnowledgeHits(rawHits) {
  if (!Array.isArray(rawHits)) {
    return [];
  }
  return rawHits
    .filter((item) => item && typeof item === 'object')
    .map((item) => {
      const candidate = /** @type {{ title?: unknown; excerpt?: unknown; category?: unknown; path?: unknown; score?: unknown }} */ (item);
      const title = typeof candidate.title === 'string' ? candidate.title.trim() : '';
      const excerpt = typeof candidate.excerpt === 'string' ? candidate.excerpt.trim() : '';
      if (!title || !excerpt) {
        return null;
      }
      return {
        title,
        excerpt,
        category: typeof candidate.category === 'string' && candidate.category.trim() ? candidate.category.trim() : 'core',
        path: typeof candidate.path === 'string' ? candidate.path.trim() : '',
        score: typeof candidate.score === 'number' ? candidate.score : undefined,
      };
    })
    .filter((item) => item !== null);
}

/**
 * @param {ChatMessage[]} messages
 * @param {KnowledgeHit[]} knowledgeHits
 * @returns {ChatMessage[]}
 */
export function attachKnowledgeHitsToMessages(messages, knowledgeHits) {
  if (!Array.isArray(messages) || messages.length === 0 || !Array.isArray(knowledgeHits) || knowledgeHits.length === 0) {
    return Array.isArray(messages) ? messages : [];
  }
  const lastAssistantIndex = [...messages].map((item) => item.role).lastIndexOf('assistant');
  if (lastAssistantIndex < 0) {
    return messages;
  }
  return messages.map((message, index) => {
    if (index !== lastAssistantIndex) {
      return message;
    }
    return {
      ...message,
      knowledgeHits,
    };
  });
}
