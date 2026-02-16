import OpenAI from "openai";
import { ILLMProvider } from "../../application/contracts/ILLMProvider";

export class OpenAIAdapter implements ILLMProvider {
  private client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
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
    const prompt = `
Analiza el mensaje: "${input.message}"
Stage: ${input.context.stage}, Trust: ${input.context.trustLevel}
Responde JSON: { "tags": [], "signals": [] }
Señales: BUY_INTENT, TECHNICAL_QUESTION, OBJECTION, POSITIVE_EMOTION, BUDGET_CONFIRMED.
    `;

    const response = await this.client.chat.completions.create({
      model: "gpt-4",
      messages: [{ role: "user", content: prompt }],
      temperature: 0,
      response_format: { type: "json_object" }
    });

    const content = response.choices[0].message.content || "{}";
    const parsed = JSON.parse(content);

    return {
      tags: parsed.tags || [],
      signals: parsed.signals || [],
      tokensUsed: response.usage?.total_tokens || 0
    };
  }
}
