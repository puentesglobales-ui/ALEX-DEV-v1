import { PrismaClient } from "@prisma/client";
import { IConversationRepository } from "../../application/contracts/IConversationRepository";
import { ConversationState } from "../../domain/entities/ConversationState";

export class PrismaConversationRepository implements IConversationRepository {
  constructor(private prisma: PrismaClient) {}

  async findOrCreate(userId: string): Promise<ConversationState> {
    const conversation = await this.prisma.conversationState.findUnique({
      where: { userId }
    });

    if (conversation) {
      return conversation as ConversationState;
    }

    const created = await this.prisma.conversationState.create({
      data: {
        userId,
        currentScore: 0,
        cumulativeScore: 0,
        lastTags: [],
        trustLevel: 50,
        stage: "discovery",
        messageCount: 0,
        conversationCost: 0,
        overBudget: false
      }
    });

    return created as ConversationState;
  }

  async update(id: string, data: Partial<ConversationState>): Promise<ConversationState> {
    const updated = await this.prisma.conversationState.update({
      where: { id },
      data
    });

    return updated as ConversationState;
  }

  async findByUserId(userId: string): Promise<ConversationState | null> {
    const conversation = await this.prisma.conversationState.findUnique({
      where: { userId }
    });
    return conversation as ConversationState | null;
  }

  async findAll(): Promise<ConversationState[]> {
    const conversations = await this.prisma.conversationState.findMany();
    return conversations as ConversationState[];
  }
}
