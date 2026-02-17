import Anthropic from "@anthropic-ai/sdk";
import { ILLMProvider } from "../../application/contracts/ILLMProvider";
import { constitutionManager } from "../../config/ConstitutionManager";

export class ClaudeAdapter implements ILLMProvider {
    private client: Anthropic;

    constructor(apiKey: string) {
        this.client = new Anthropic({ apiKey });
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
        const response = await this.client.messages.create({
            model: "claude-3-5-sonnet-20240620",
            max_tokens: 1000,
            messages: [{
                role: "user",
                content: `Analiza el mensaje: "${input.message}". Responde JSON: { "tags": [], "signals": [] }`
            }]
        });

        const content = (response.content[0] as any).text || "{}";
        const parsed = JSON.parse(content);

        return {
            tags: parsed.tags || [],
            signals: parsed.signals || [],
            tokensUsed: response.usage.input_tokens + response.usage.output_tokens
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

        const response = await this.client.messages.create({
            model: "claude-3-5-sonnet-20240620",
            max_tokens: 2048,
            system: systemPrompt,
            messages: [
                ...input.history.map(h => ({ role: h.role === "user" ? "user" : "assistant", content: h.content })) as any,
                { role: "user", content: input.message }
            ]
        });

        return {
            text: (response.content[0] as any).text || "",
            tokensUsed: response.usage.input_tokens + response.usage.output_tokens
        };
    }
}
