import OpenAI from "openai";
import { ILLMProvider } from "../../application/contracts/ILLMProvider";
import { constitutionManager } from "../../config/ConstitutionManager";

export class DeepSeekAdapter implements ILLMProvider {
    private client: OpenAI;

    constructor(apiKey: string) {
        this.client = new OpenAI({
            apiKey: apiKey,
            baseURL: "https://api.deepseek.com"
        });
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
        const response = await this.client.chat.completions.create({
            model: "deepseek-chat",
            messages: [{
                role: "user",
                content: `Analiza el mensaje: "${input.message}". Responde JSON: { "tags": [], "signals": [] }`
            }],
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
        const systemPrompt = constitutionManager.buildPrompt(
            input.constitutionId || "conversational-programming",
            input.customContext
        );

        const response = await this.client.chat.completions.create({
            model: "deepseek-chat",
            messages: [
                { role: "system", content: systemPrompt },
                ...input.history as any,
                { role: "user", content: input.message }
            ],
            temperature: 0.7
        });

        return {
            text: response.choices[0].message.content || "",
            tokensUsed: response.usage?.total_tokens || 0
        };
    }
}
