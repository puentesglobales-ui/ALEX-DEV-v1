export interface ConversationState {
  id: string;
  userId: string;
  currentScore: number;
  cumulativeScore: number;
  lastTags: string[];
  trustLevel: number;
  stage: string;
  messageCount: number;
  conversationCost: number;
  overBudget: boolean;
  lastInteractionAt: Date;
  createdAt: Date;
  updatedAt: Date;
}
