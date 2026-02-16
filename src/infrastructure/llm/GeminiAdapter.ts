import { GoogleGenerativeAI } from "@google/generative-ai";
import { ILLMProvider } from "../../application/contracts/ILLMProvider";

export class GeminiAdapter implements ILLMProvider {
    private genAI: GoogleGenerativeAI;
    private modelName: string;

    constructor(apiKey: string, modelName: string = "gemini-1.5-flash") {
        this.genAI = new GoogleGenerativeAI(apiKey);
        this.modelName = modelName;
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
        const model = this.genAI.getGenerativeModel({
            model: this.modelName,
            generationConfig: { responseMimeType: "application/json" }
        });

        const prompt = `
Eres un motor de análisis cognitivo especializado en Ingeniería de Software. Tu objetivo es analizar el mensaje de un desarrollador o usuario técnico para clasificar su intención y nivel de complejidad.

MENSAJE: "${input.message}"
ESTADO ACTUAL DEL PROYECTO: Stage: ${input.context.stage}, Readiness Score: ${input.context.trustLevel}
ÚLTIMOS TAGS TÉCNICOS: ${input.context.lastTags.join(", ")}

Responde ÚNICAMENTE en formato JSON con la siguiente estructura:
{
  "tags": ["lista de tecnologías o patrones detectados"],
  "signals": ["DEBUG_REQUEST", "REFACTOR_REQUEST", "ARCHITECTURE_DESIGN", "OPTIMIZATION_SUGGESTION", "TECHNICAL_BLOCKER", "CLARIFICATION_PROVIDED"],
  "explanation": "breve razonamiento técnico"
}

Señales permitidas:
- DEBUG_REQUEST: Petición de corregir un error o bug.
- REFACTOR_REQUEST: Sugerencia o petición para mejorar código existente.
- ARCHITECTURE_DESIGN: Consultas sobre estructura, patrones o diseño de sistemas.
- OPTIMIZATION_SUGGESTION: Búsqueda de mejoras de rendimiento.
- TECHNICAL_BLOCKER: El usuario está atascado con un problema crítico.
- CLARIFICATION_PROVIDED: El usuario aporta más datos sobre un problema.
    `;

        try {
            const result = await model.generateContent(prompt);
            const response = result.response;
            const text = response.text();
            const parsed = JSON.parse(text);

            return {
                tags: parsed.tags || [],
                signals: parsed.signals || [],
                tokensUsed: response.usageMetadata?.totalTokenCount || 0
            };
        } catch (error) {
            console.error("❌ Gemini Adapter Error:", error);
            return {
                tags: ["ERROR"],
                signals: [],
                tokensUsed: 0
            };
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
        const model = this.genAI.getGenerativeModel({
            model: this.modelName,
            systemInstruction: "Eres Alexa, una Technical Co-founder y experta programadora de Puentes Globales. Tu objetivo es ayudar a Gabriel a programar sistemas robustos y escalables. Eres directa, técnica, pero con visión de negocio. Usas arquitectura hexagonal y Clean Code por defecto."
        });

        const chatHistory = input.history.map(h => ({
            role: h.role === "user" ? "user" : "model",
            parts: [{ text: h.content }]
        }));

        // Asegurar que el historial empieza con user
        while (chatHistory.length > 0 && chatHistory[0].role !== "user") {
            chatHistory.shift();
        }

        const chat = model.startChat({
            history: chatHistory,
        });

        try {
            const result = await chat.sendMessage(input.message);
            return {
                text: result.response.text(),
                tokensUsed: result.response.usageMetadata?.totalTokenCount || 0
            };
        } catch (error) {
            console.error("❌ Gemini Chat Error:", error);
            return {
                text: "Lo siento Gabriel, tuve un micro-corte en mi núcleo de procesamiento. ¿Puedes repetir eso?",
                tokensUsed: 0
            };
        }
    }
}
