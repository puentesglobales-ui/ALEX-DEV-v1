export interface IConversationEventRepository {
  create(event: {
    conversationId: string;
    type: string;
    metadata: any;
  }): Promise<void>;

  findByConversation(conversationId: string): Promise<any[]>;
}
