export interface ILLMProvider {
  classify(input: {
    message: string;
    context: {
      lastTags: string[];
      stage: string;
      trustLevel: number;
    };
    constitutionId?: string;
  }): Promise<{
    tags: string[];
    signals: string[];
    tokensUsed: number;
  }>;

  generateResponse(input: {
    message: string;
    history: { role: string; content: string }[];
    context: {
      stage: string;
      trustLevel: number;
    };
    constitutionId?: string;
    customContext?: string;
  }): Promise<{
    text: string;
    tokensUsed: number;
  }>;
}
