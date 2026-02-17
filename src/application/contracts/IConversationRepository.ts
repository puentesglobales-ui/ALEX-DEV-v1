import { ConversationState } from "../../domain/entities/ConversationState";

export interface IConversationRepository {
  findOrCreate(userId: string): Promise<ConversationState>;
  update(id: string, data: Partial<ConversationState>): Promise<ConversationState>;
  findByUserId(userId: string): Promise<ConversationState | null>;
  findAll(): Promise<ConversationState[]>;
}
