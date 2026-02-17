import OpenAI from "openai";
import { ILLMProvider } from "../../application/contracts/ILLMProvider";
import { constitutionManager } from "../../config/ConstitutionManager";

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
    constitutionId?: string;
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

  async generateResponse(input: {
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
  }> {
    const constitution = input.constitutionId 
      ? constitutionManager.get(input.constitutionId)
      : constitutionManager.get("conversational-programming");

    const systemPrompt = constitutionManager.buildPrompt(
      input.constitutionId || "conversational-programming",
      input.customContext
    );

    const response = await this.client.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        ...input.history as any,
        { role: "user", content: input.message }
      ],
      temperature: constitution?.communication.responseFormat === "direct" ? 0.3 : 0.7
    });

    return {
      text: response.choices[0].message.content || "",
      tokensUsed: response.usage?.total_tokens || 0
    };
  }
}
