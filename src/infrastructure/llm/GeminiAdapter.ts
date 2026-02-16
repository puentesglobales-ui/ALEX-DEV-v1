import { GoogleGenerativeAI } from "@google/generative-ai";
import { ILLMProvider } from "../../application/contracts/ILLMProvider";

export class GeminiAdapter implements ILLMProvider {
    private genAI: GoogleGenerativeAI;

    constructor(apiKey: string) {
        this.genAI = new GoogleGenerativeAI(apiKey);
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
            model: "gemini-1.5-flash",
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
}
