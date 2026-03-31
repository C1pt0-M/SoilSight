import type { KnowledgeHit, PlanChatMessage } from '../models/shi';

export function normalizeKnowledgeHits(rawHits: unknown): KnowledgeHit[];
export function attachKnowledgeHitsToMessages(
  messages: PlanChatMessage[],
  knowledgeHits: KnowledgeHit[]
): PlanChatMessage[];
