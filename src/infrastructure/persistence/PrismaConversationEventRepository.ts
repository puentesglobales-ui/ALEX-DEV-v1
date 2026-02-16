import { PrismaClient } from "@prisma/client";
import { IConversationEventRepository } from "../../application/contracts/IConversationEventRepository";

export class PrismaConversationEventRepository implements IConversationEventRepository {
  constructor(private prisma: PrismaClient) {}

  async create(event: {
    conversationId: string;
    type: string;
    metadata: any;
  }): Promise<void> {
    await this.prisma.conversationEvent.create({
      data: {
        conversationId: event.conversationId,
        type: event.type,
        metadata: event.metadata
      }
    });
  }

  async findByConversation(conversationId: string): Promise<any[]> {
    return this.prisma.conversationEvent.findMany({
      where: { conversationId },
      orderBy: { createdAt: "asc" }
    });
  }
}
