import { IConversationRepository } from "../contracts/IConversationRepository";
import { IConversationEventRepository } from "../contracts/IConversationEventRepository";
import { ILLMProvider } from "../contracts/ILLMProvider";

export interface ChatInput {
    userId: string;
    message: string;
    constitutionId?: string;
    customContext?: string;
}

export interface ChatOutput {
    response: string;
    stage: string;
    trustLevel: number;
}

export class GenerateResponse {
    constructor(
        private conversationRepo: IConversationRepository,
        private eventRepo: IConversationEventRepository,
        private llmProvider: ILLMProvider
    ) { }

    async execute(input: ChatInput): Promise<ChatOutput> {
        const conversation = await this.conversationRepo.findOrCreate(input.userId);

        // 1. Obtener historial reciente (opcional para el prompt)
        const recentEvents = await this.eventRepo.findByConversation(conversation.id);
        const history = recentEvents
            .filter(e => e.type === "MESSAGE" || e.type === "ASSISTANT_RESPONSE")
            .slice(-10)
            .map(e => ({
                role: e.type === "MESSAGE" ? "user" : "assistant",
                content: (e.metadata as any).content
            }));

        // 2. Generar respuesta usando el proveedor de LLM con constitución
        const result = await (this.llmProvider as any).generateResponse({
            message: input.message,
            history,
            context: {
                stage: conversation.stage,
                trustLevel: conversation.trustLevel
            },
            constitutionId: input.constitutionId,
            customContext: input.customContext
        });

        // 3. Registrar la respuesta del asistente
        await this.eventRepo.create({
            conversationId: conversation.id,
            type: "ASSISTANT_RESPONSE",
            metadata: { content: result.text }
        });

        return {
            response: result.text,
            stage: conversation.stage,
            trustLevel: conversation.trustLevel
        };
    }
}
