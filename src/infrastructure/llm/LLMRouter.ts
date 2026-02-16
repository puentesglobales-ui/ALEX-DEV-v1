import { ILLMProvider } from "../../application/contracts/ILLMProvider";

export class LLMRouter implements ILLMProvider {
  private providers: ILLMProvider[];

  constructor(providers: ILLMProvider[]) {
    this.providers = providers;
  }

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
    let lastError = new Error("No providers available");

    for (const provider of this.providers) {
      try {
        return await provider.classify(input);
      } catch (error) {
        lastError = error as Error;
        console.warn(`⚠️ LLMRouter Classify: Provider failed, trying next...`);
      }
    }
    throw lastError;
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
    let lastError = new Error("No providers available");

    for (const provider of this.providers) {
      try {
        return await provider.generateResponse(input);
      } catch (error) {
        lastError = error as Error;
        console.warn(`⚠️ LLMRouter Chat: Provider failed, trying next...`);
      }
    }
    throw lastError;
  }
}
