import { IConversationRepository } from "../contracts/IConversationRepository";
import { IConversationEventRepository } from "../contracts/IConversationEventRepository";
import { ILLMProvider } from "../contracts/ILLMProvider";
import { ScoreEngine } from "../../domain/services/ScoreEngine";
import { CostTracker } from "../../infrastructure/cost/CostTracker";

export interface TagMessageInput {
  userId: string;
  message: string;
}

export interface TagMessageOutput {
  conversationId: string;
  currentScore: number;
  stage: string;
  trustLevel: number;
  tags: string[];
  signals: string[];
  cost: number;
}

export class TagMessage {
  constructor(
    private conversationRepo: IConversationRepository,
    private eventRepo: IConversationEventRepository,
    private llmProvider: ILLMProvider,
    private scoreEngine: ScoreEngine,
    private costTracker: CostTracker
  ) {}

  async execute(input: TagMessageInput): Promise<TagMessageOutput> {
    const conversation = await this.conversationRepo.findOrCreate(input.userId);

    await this.eventRepo.create({
      conversationId: conversation.id,
      type: "MESSAGE",
      metadata: { content: input.message }
    });

    let classification;
    try {
      classification = await this.llmProvider.classify({
        message: input.message,
        context: {
          lastTags: conversation.lastTags,
          stage: conversation.stage,
          trustLevel: conversation.trustLevel
        }
      });
    } catch (error) {
      classification = {
        tags: ["UNCLASSIFIED"],
        signals: [],
        tokensUsed: 0
      };
    }

    if (classification.signals.length > 0) {
      await this.eventRepo.create({
        conversationId: conversation.id,
        type: "SIGNALS_DETECTED",
        metadata: { signals: classification.signals }
      });
    }

    const newScore = this.scoreEngine.updateScore(conversation.currentScore, classification.signals);
    const newStage = this.scoreEngine.deriveStage(newScore);

    if (newStage !== conversation.stage) {
      await this.eventRepo.create({
        conversationId: conversation.id,
        type: "STAGE_CHANGE",
        metadata: { from: conversation.stage, to: newStage }
      });
    }

    const messageCost = this.costTracker.calculateCost(classification.tokensUsed);
    const totalCost = conversation.conversationCost + messageCost;
    const isOverBudget = this.costTracker.isOverBudget(totalCost);

    let trustDelta = 0;
    if (classification.signals.includes("POSITIVE_EMOTION")) trustDelta = 5;
    if (classification.signals.includes("OBJECTION")) trustDelta = -5;
    const newTrust = Math.max(0, Math.min(100, conversation.trustLevel + trustDelta));

    await this.conversationRepo.update(conversation.id, {
      currentScore: newScore,
      cumulativeScore: conversation.cumulativeScore + (newScore > conversation.currentScore ? newScore - conversation.currentScore : 0),
      lastTags: classification.tags,
      trustLevel: newTrust,
      stage: newStage,
      messageCount: conversation.messageCount + 1,
      conversationCost: totalCost,
      overBudget: isOverBudget,
      lastInteractionAt: new Date()
    });

    return {
      conversationId: conversation.id,
      currentScore: newScore,
      stage: newStage,
      trustLevel: newTrust,
      tags: classification.tags,
      signals: classification.signals,
      cost: messageCost
    };
  }
}
