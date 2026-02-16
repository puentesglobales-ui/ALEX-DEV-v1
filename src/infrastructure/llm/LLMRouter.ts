import { ILLMProvider } from "../../application/contracts/ILLMProvider";

export class LLMRouter implements ILLMProvider {
  constructor(
    private primaryProvider: ILLMProvider,
    private fallbackProvider?: ILLMProvider
  ) { }

  async classify(input: {
    message: string;
    context: {
      lastTags: string[];
      stage: string;
      trustLevel: number;
    };
  }): Promise<{
    tags: string[];
    signals: string[];
    tokensUsed: number;
  }> {
    try {
      return await this.primaryProvider.classify(input);
    } catch (error) {
      if (this.fallbackProvider) {
        console.warn("⚠️ LLMRouter: Primary provider failed, using fallback...");
        return await this.fallbackProvider.classify(input);
      }
      throw error;
    }
  }

  async generateResponse(input: {
    message: string;
    history: { role: string; content: string }[];
    context: {
      stage: string;
      trustLevel: number;
    };
  }): Promise<{
    text: string;
    tokensUsed: number;
  }> {
    try {
      return await this.primaryProvider.generateResponse(input);
    } catch (error) {
      if (this.fallbackProvider) {
        console.warn("⚠️ LLMRouter Chat: Primary failed, using fallback...");
        return await this.fallbackProvider.generateResponse(input);
      }
      throw error;
    }
  }
}
