import Fastify from "fastify";
import rateLimit from "@fastify/rate-limit";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import path from "path";
import { PrismaClient } from "@prisma/client";
import { env, validateEnv } from "./config/env";
import { apiKeyAuth } from "./middleware/apiKeyAuth";
import { constitutionManager } from "./config/ConstitutionManager";
import { whatsappManager } from "./infrastructure/whatsapp/WhatsAppManager";
import { Bitrix24Client } from "./infrastructure/crm/Bitrix24Client";
import { tenantManager } from "./infrastructure/multiTenant/TenantManager";

// Domain
import { ScoreEngine } from "./domain/services/ScoreEngine";

// Application
import { TagMessage } from "./application/use-cases/TagMessage";
import { GenerateResponse } from "./application/use-cases/GenerateResponse";

// Infrastructure
import { PrismaConversationRepository } from "./infrastructure/persistence/PrismaConversationRepository";
import { PrismaConversationEventRepository } from "./infrastructure/persistence/PrismaConversationEventRepository";
import { OpenAIAdapter } from "./infrastructure/llm/OpenAIAdapter";
import { GeminiAdapter } from "./infrastructure/llm/GeminiAdapter";
import { ClaudeAdapter } from "./infrastructure/llm/ClaudeAdapter";
import { DeepSeekAdapter } from "./infrastructure/llm/DeepSeekAdapter";
import { LLMRouter } from "./infrastructure/llm/LLMRouter";
import { CostTracker } from "./infrastructure/cost/CostTracker";

async function bootstrap() {
  try {
    validateEnv();

    const app = Fastify({ logger: true });

    await app.register(cors);
    await app.register(rateLimit, {
      max: 100,
      timeWindow: "1 minute"
    });

    await app.register(fastifyStatic, {
      root: path.join(__dirname, "../public"),
      prefix: "/",
    });

    const prisma = new PrismaClient();
    const conversationRepo = new PrismaConversationRepository(prisma);
    const eventRepo = new PrismaConversationEventRepository(prisma);

    // Configurar Adaptadores (Los 5 Fantásticos)
    const claudeAdapter = new ClaudeAdapter(env.CLAUDE_API_KEY);
    const chatGPTAdapter = new OpenAIAdapter(env.OPENAI_API_KEY);
    const deepSeekAdapter = new DeepSeekAdapter(env.DEEPSEEK_API_KEY);
    const geminiProAdapter = new GeminiAdapter(env.GEMINI_API_KEY, "gemini-1.5-pro");
    const geminiFlashAdapter = new GeminiAdapter(env.GEMINI_API_KEY, "gemini-1.5-flash");

    // Prioridad Sugerida: Claude (Máxima Calidad) -> Gemini Pro -> ChatGPT -> DeepSeek -> Gemini Flash (Gratis/Rápido)
    const llmRouter = new LLMRouter([
      claudeAdapter,
      geminiProAdapter,
      chatGPTAdapter,
      deepSeekAdapter,
      geminiFlashAdapter
    ]);
    const costTracker = new CostTracker({
      costPer1kTokens: env.COST_PER_1K_TOKENS,
      budgetThreshold: env.BUDGET_THRESHOLD
    });

    const scoreEngine = new ScoreEngine();

    const tagMessage = new TagMessage(
      conversationRepo,
      eventRepo,
      llmRouter,
      scoreEngine,
      costTracker
    );

    const generateResponse = new GenerateResponse(
      conversationRepo,
      eventRepo,
      llmRouter
    );

    app.post("/brain/chat", async (request, reply) => {
      try {
        await apiKeyAuth(request, reply, env.API_KEY);
        const { userId, message, constitutionId, customContext } = request.body as { 
          userId: string; 
          message: string;
          constitutionId?: string;
          customContext?: string;
        };
        if (!userId || !message) return reply.status(400).send({ error: "Missing userId or message" });

        const result = await generateResponse.execute({ userId, message, constitutionId, customContext });
        return result;
      } catch (err: any) {
        request.log.error(err);
        return reply.status(500).send({
          error: "Internal Server Error",
          message: err.message,
          stack: env.NODE_ENV === 'development' ? err.stack : undefined,
          hint: "Check DATABASE_URL and LLM API Keys in Render environment variables."
        });
      }
    });

    app.get("/brain/constitutions", async (request, reply) => {
      await apiKeyAuth(request, reply, env.API_KEY);
      const constitutions = constitutionManager.getAll().map(c => ({
        id: c.id,
        name: c.name,
        version: c.version,
        description: c.description
      }));
      return { constitutions };
    });

    app.post("/brain/tag", async (request, reply) => {
      try {
        await apiKeyAuth(request, reply, env.API_KEY);
        const { userId, message, constitutionId, schemas } = request.body as { 
          userId: string; 
          message: string;
          constitutionId?: string;
          schemas?: string[];
        };
        if (!userId || !message) return reply.status(400).send({ error: "Missing userId or message" });

        const result = await tagMessage.execute({ userId, message });
        return result;
      } catch (err: any) {
        request.log.error(err);
        return reply.status(500).send({ error: "Internal Server Error", message: err.message });
      }
    });

    app.post("/label", async (request, reply) => {
      try {
        await apiKeyAuth(request, reply, env.API_KEY);
        const { 
          content, 
          schemas = ["sentiment", "intent", "language"],
          customSchema,
          returnJustification = true
        } = request.body as {
          content: string;
          schemas?: string[];
          customSchema?: { name: string; labels: string[] };
          returnJustification?: boolean;
        };

        if (!content) return reply.status(400).send({ error: "Missing content" });

        const constitution = constitutionManager.get("data-labeler");
        const availableSchemas = constitution?.labelSchemas || {};
        
        const systemPrompt = `Eres un etiquetador profesional de datos para IA.
Analiza el siguiente contenido y asigna etiquetas según los esquemas solicitados.

ESCUELAS DISPONIBLES:
${Object.entries(availableSchemas).map(([k, v]) => `${k}: ${(v as string[]).join(", ")}`).join("\n")}

${customSchema ? `ESCUELA PERSONALIZADA:
- ${customSchema.name}: ${customSchema.labels.join(", ")}` : ""}

CONTENIDO A ETIQUETAR:
"${content}"

Responde en JSON:
{
  "labels": {
    "nombre_schema": ["etiqueta1", "etiqueta2"],
    ...
  },
  "confidence": 0.0-1.0,
  "justification": "breve explicación",
  "language": "idioma detectado"
}`;

        const llmProvider = llmRouter;
        const result = await (llmProvider as any).generateResponse({
          message: `Etiqueta este contenido: ${content}`,
          history: [],
          context: { stage: "labeling", trustLevel: 100 },
          constitutionId: "data-labeler",
          customContext: `Esquemas a usar: ${schemas.join(", ")}`
        });

        let parsed;
        try {
          parsed = JSON.parse(result.text);
        } catch {
          parsed = { labels: {}, raw: result.text, error: "Parse error" };
        }

        return {
          content,
          labels: parsed.labels || {},
          confidence: parsed.confidence || 0.8,
          justification: returnJustification ? parsed.justification : undefined,
          language: parsed.language,
          tokensUsed: result.tokensUsed
        };
      } catch (err: any) {
        request.log.error(err);
        return reply.status(500).send({ error: "Labeling Error", message: err.message });
      }
    });

    app.post("/label/batch", async (request, reply) => {
      try {
        await apiKeyAuth(request, reply, env.API_KEY);
        const { contents, schemas = ["sentiment", "intent"] } = request.body as {
          contents: string[];
          schemas?: string[];
        };

        if (!contents || contents.length === 0) {
          return reply.status(400).send({ error: "Missing contents array" });
        }

        const results = [];
        for (const content of contents) {
          const result = await (async () => {
            const constitution = constitutionManager.get("data-labeler");
            const systemPrompt = constitution?.systemPrompt || "";
            
            const llmProvider = llmRouter;
            const response = await (llmProvider as any).generateResponse({
              message: `Etiqueta: ${content}`,
              history: [],
              context: { stage: "batch", trustLevel: 100 },
              constitutionId: "data-labeler",
              customContext: `Esquemas: ${schemas.join(", ")}`
            });

            try {
              return JSON.parse(response.text);
            } catch {
              return { raw: response.text };
            }
          })();
          results.push({ content, ...result });
        }

        return { total: results.length, results };
      } catch (err: any) {
        request.log.error(err);
        return reply.status(500).send({ error: "Batch Labeling Error", message: err.message });
      }
    });

    // === ALEX CEREBRO - Sistema de Etiquetado Profesional ===
    
    app.post("/cerebro/task", async (request, reply) => {
      try {
        await apiKeyAuth(request, reply, env.API_KEY);
        const { 
          content, 
          schemas,
          difficulty = "medium",
          requiresConsensus = false,
          professionalId,
          context
        } = request.body as {
          content: string;
          schemas: string[];
          difficulty?: string;
          requiresConsensus?: boolean;
          professionalId?: string;
          context?: string;
        };

        if (!content || !schemas) {
          return reply.status(400).send({ error: "Missing content or schemas" });
        }

        const constitution = constitutionManager.get("alex-cerebro-labeling");
        const startTime = Date.now();

        const llmProvider = llmRouter;
        const result = await (llmProvider as any).generateResponse({
          message: `ETIQUETAR: ${content}`,
          history: [],
          context: { stage: "task", trustLevel: 100 },
          constitutionId: "alex-cerebro-labeling",
          customContext: `Dificultad: ${difficulty}\nRequiere consenso: ${requiresConsensus}\nContexto: ${context || "N/A"}`
        });

        const responseTime = Date.now() - startTime;
        let parsed;
        try {
          parsed = JSON.parse(result.text);
        } catch {
          parsed = { labels: {}, raw: result.text };
        }

        const taskResult = {
          taskId: `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          content,
          labels: parsed.labels || {},
          schemas,
          difficulty,
          requiresConsensus,
          professionalId: professionalId || "anonymous",
          responseTimeMs: responseTime,
          confidence: parsed.confidence || 0.8,
          timestamp: new Date().toISOString(),
          cost: (responseTime / 1000) * 0.001,
          tokensUsed: result.tokensUsed
        };

        await eventRepo.create({
          conversationId: "cerebro",
          type: "TASK_COMPLETED",
          metadata: taskResult
        });

        return taskResult;
      } catch (err: any) {
        request.log.error(err);
        return reply.status(500).send({ error: "Cerebro Task Error", message: err.message });
      }
    });

    // === TALKME - Instructor Inteligente de Idiomas ===

    const PLAN_LIMITS = {
      free: { dailyMinutes: 5, maxInteractions: 10, tokensPerSession: 500 },
      basic: { dailyMinutes: 20, maxInteractions: 100, tokensPerSession: 2000 },
      pro: { dailyMinutes: 999, maxInteractions: 9999, tokensPerSession: 5000 }
    };

    const SESSION_STRUCTURE = {
      warmup: "Warm-up breve (30 seg)",
      guidedConversation: "Conversación guiada",
      structuredCorrection: "Corrección estructurada",
      miniChallenge: "Mini desafío",
      cta: "Call to action"
    };

    app.post("/talkme/session", async (request, reply) => {
      try {
        await apiKeyAuth(request, reply, env.API_KEY);
        const { 
          userId, 
          message,
          plan = "free",
          language = "en",
          sessionPhase,
          topic
        } = request.body as {
          userId: string;
          message: string;
          plan?: "free" | "basic" | "pro";
          language?: string;
          sessionPhase?: string;
          topic?: string;
        };

        const limits = PLAN_LIMITS[plan];
        
        const conversation = await conversationRepo.findOrCreate(`talkme_${userId}`);
        
        const recentEvents = await eventRepo.findByConversation(conversation.id);
        const todayInteractions = recentEvents.filter(e => {
          const created = new Date(e.createdAt);
          const today = new Date();
          return created.toDateString() === today.toDateString();
        }).length;

        if (todayInteractions >= limits.maxInteractions) {
          return reply.status(429).send({ 
            error: "Límite diario alcanzado",
            plan,
            upgrade: plan === "free" ? "basic" : "pro",
            message: "Has alcanzado tu límite diario. ¡Mejora a Plan Básico para más conversaciones!"
          });
        }

        const recentHistory = recentEvents
          .filter(e => e.type === "TALKME_MESSAGE" || e.type === "TALKME_RESPONSE")
          .slice(-10)
          .map(e => ({
            role: e.type === "TALKME_MESSAGE" ? "user" : "assistant",
            content: (e.metadata as any).content
          }));

        const constitution = constitutionManager.get("talkme-tutor");
        
        let sessionInstruction = "";
        if (sessionPhase) {
          const phases = SESSION_STRUCTURE as any;
          sessionInstruction = `\nFASE ACTUAL: ${sessionPhase}`;
          if (sessionPhase === "warmup") {
            sessionInstruction += "\n warm-up breve de 30 segundos";
          } else if (sessionPhase === "guidedConversation") {
            sessionInstruction += `\nTema: ${topic || "conversación general"}`;
          } else if (sessionPhase === "structuredCorrection") {
            sessionInstruction += "\nCorrige errores de forma constructiva";
          } else if (sessionPhase === "miniChallenge") {
            sessionInstruction += "\nPropón un mini desafío";
          } else if (sessionPhase === "cta") {
            sessionInstruction += "\n Incluye call to action para que vuelva";
          }
        }

        const llmProvider = llmRouter;
        const result = await (llmProvider as any).generateResponse({
          message,
          history: recentHistory,
          context: { stage: plan, trustLevel: conversation.trustLevel },
          constitutionId: "talkme-tutor",
          customContext: `Idioma: ${language}\nPlan: ${plan}\n${sessionInstruction}`
        });

        await eventRepo.create({
          conversationId: conversation.id,
          type: "TALKME_MESSAGE",
          metadata: { content: message, language, plan }
        });

        await eventRepo.create({
          conversationId: conversation.id,
          type: "TALKME_RESPONSE",
          metadata: { content: result.text, language, plan }
        });

        await conversationRepo.update(conversation.id, {
          messageCount: conversation.messageCount + 1,
          conversationCost: conversation.conversationCost + (result.tokensUsed * 0.001)
        });

        return {
          response: result.text,
          sessionPhase: sessionPhase || "conversation",
          language,
          plan,
          limitsRemaining: {
            interactions: limits.maxInteractions - todayInteractions - 1,
            minutes: limits.dailyMinutes
          },
          tokensUsed: result.tokensUsed,
          nextPhase: getNextPhase(sessionPhase)
        };
      } catch (err: any) {
        request.log.error(err);
        return reply.status(500).send({ error: "TalkMe Session Error", message: err.message });
      }
    });

    function getNextPhase(currentPhase?: string): string {
      const phases = ["warmup", "guidedConversation", "structuredCorrection", "miniChallenge", "cta"];
      if (!currentPhase) return "guidedConversation";
      const idx = phases.indexOf(currentPhase);
      return idx < phases.length - 1 ? phases[idx + 1] : "cta";
    }

    app.get("/talkme/progress/:userId", async (request, reply) => {
      await apiKeyAuth(request, reply, env.API_KEY);
      const { userId } = request.params as { userId: string };

      const conversation = await conversationRepo.findByUserId(`talkme_${userId}`);
      if (!conversation) {
        return { error: "Usuario no encontrado", userId };
      }

      const events = await eventRepo.findByConversation(conversation.id);
      const talkmeEvents = events.filter(e => 
        e.type === "TALKME_MESSAGE" || e.type === "TALKME_RESPONSE"
      );

      const errors: string[] = [];
      talkmeEvents.forEach(e => {
        if ((e.metadata as any).errors) {
          errors.push(...((e.metadata as any).errors as string[]));
        }
      });

      return {
        userId,
        totalSessions: Math.floor(talkmeEvents.length / 2),
        totalMessages: talkmeEvents.length,
        currentLevel: estimateCEFRLevel(conversation.messageCount),
        errorsCount: errors.length,
        commonErrors: errors.slice(0, 5),
        vocabularyLearned: Math.floor(conversation.messageCount * 2),
        progress: Math.min(100, conversation.messageCount * 2)
      };
    });

    function estimateCEFRLevel(messages: number): string {
      if (messages < 20) return "A1";
      if (messages < 50) return "A2";
      if (messages < 100) return "B1";
      if (messages < 200) return "B2";
      if (messages < 500) return "C1";
      return "C2";
    }

    app.get("/talkme/metrics", async (request, reply) => {
      await apiKeyAuth(request, reply, env.API_KEY);
      
      const allConversations = await conversationRepo.findAll();
      const talkmeConvos = allConversations.filter(c => c.userId.startsWith("talkme_"));
      
      const totalUsers = talkmeConvos.length;
      const freeUsers = talkmeConvos.filter(c => c.userId.includes("free")).length;
      const basicUsers = talkmeConvos.filter(c => c.userId.includes("basic")).length;
      const proUsers = talkmeConvos.filter(c => c.userId.includes("pro")).length;
      
      const totalMessages = talkmeConvos.reduce((sum, c) => sum + c.messageCount, 0);
      const totalCost = talkmeConvos.reduce((sum, c) => sum + c.conversationCost, 0);
      
      return {
        totalUsers,
        usersByPlan: { free: freeUsers, basic: basicUsers, pro: proUsers },
        totalMessages,
        totalCost: totalCost.toFixed(4),
        avgCostPerUser: totalUsers > 0 ? (totalCost / totalUsers).toFixed(4) : "0",
        conversionRate: "Pendiente"
      };
    });

    // === ALEX WHATSAPP - Optimización Extrema de Costos ===

    const WHATSAPP_TOKEN_LIMITS = {
      maxTokensPerResponse: 150,
      maxTokensDaily: 1000,
      maxTokensMonthly: 15000,
      timeoutMs: 5000
    };

    const USER_VALUE_CONFIG = {
      soporte: { priority: "high", maxTokens: 200 },
      venta: { priority: "high", maxTokens: 250 },
      lead_frio: { priority: "medium", maxTokens: 150 },
      cliente_activo: { priority: "high", maxTokens: 300 },
      no_convertido: { priority: "low", maxTokens: 100 }
    };

    const userCostTracker = new Map<string, { dailyTokens: number; monthlyTokens: number; lastReset: Date }>();

    function getUserCostLimit(userId: string, segment: string): number {
      return USER_VALUE_CONFIG[segment as keyof typeof USER_VALUE_CONFIG]?.maxTokens || 150;
    }

    function checkTokenLimit(userId: string, tokens: number): { allowed: boolean; remaining: number } {
      let tracker = userCostTracker.get(userId);
      const now = new Date();
      
      if (!tracker) {
        tracker = { dailyTokens: 0, monthlyTokens: 0, lastReset: now };
        userCostTracker.set(userId, tracker);
      }

      const dayDiff = Math.floor((now.getTime() - tracker.lastReset.getTime()) / (1000 * 60 * 60 * 24));
      if (dayDiff >= 1) {
        tracker.dailyTokens = 0;
        tracker.lastReset = now;
      }

      const remaining = WHATSAPP_TOKEN_LIMITS.maxTokensDaily - tracker.dailyTokens;
      if (tokens > remaining) {
        return { allowed: false, remaining };
      }

      tracker.dailyTokens += tokens;
      return { allowed: true, remaining: remaining - tokens };
    }

    app.post("/whatsapp/chat", async (request, reply) => {
      try {
        await apiKeyAuth(request, reply, env.API_KEY);
        const { 
          userId, 
          message,
          userSegment = "lead_frio",
          useRulesFirst = true
        } = request.body as {
          userId: string;
          message: string;
          userSegment?: string;
          useRulesFirst?: boolean;
        };

        const startTime = Date.now();
        let modelUsed = "none";
        let fallbackAttempted = false;

        const ruleBasedResponses: Record<string, string> = {
          "hola": "¡Hola! ¿En qué puedo ayudarte hoy?",
          "hello": "Hi! How can I help you?",
          "gracias": "¡De nada! ¿Algo más?",
          "thanks": "You're welcome! Anything else?",
          "adiós": "¡Hasta luego! Que tengas un buen día.",
          "bye": "Goodbye! Have a great day."
        };

        const messageLower = message.toLowerCase().trim();
        if (useRulesFirst && ruleBasedResponses[messageLower]) {
          return {
            response: ruleBasedResponses[messageLower],
            source: "rule_based",
            responseTimeMs: Date.now() - startTime,
            tokensUsed: 5,
            cost: 0.0001
          };
        }

        const maxTokens = getUserCostLimit(userId, userSegment);
        const limitCheck = checkTokenLimit(userId, maxTokens);
        
        if (!limitCheck.allowed) {
          return reply.status(429).send({
            error: "Límite diario alcanzado",
            remaining: limitCheck.remaining,
            message: "Has alcanzado tu límite diario. Vuelve mañana o mejora tu plan."
          });
        }

        const conversation = await conversationRepo.findOrCreate(`wa_${userId}`);
        const recentEvents = await eventRepo.findByConversation(conversation.id);
        const memory = recentEvents
          .filter(e => e.type === "WHATSAPP_MESSAGE")
          .slice(-5)
          .map(e => ({
            role: "user",
            content: (e.metadata as any).content
          }));

        const memorySummary = memory.length > 0 
          ? `Contexto: ${memory.map(m => m.content).join(" | ")}`
          : "Sin contexto previo";

        const constitution = constitutionManager.get("alex-whatsapp-optimizer");
        
        try {
          modelUsed = "gemini-flash";
          const geminiAdapter = new GeminiAdapter(env.GEMINI_API_KEY, "gemini-1.5-flash");
          const result = await geminiAdapter.generateResponse({
            message,
            history: [],
            context: { stage: userSegment, trustLevel: conversation.trustLevel },
            constitutionId: "alex-whatsapp-optimizer",
            customContext: `${memorySummary}\nLímite: ${maxTokens} tokens máximo`
          });

          const responseTime = Date.now() - startTime;
          
          await eventRepo.create({
            conversationId: conversation.id,
            type: "WHATSAPP_MESSAGE",
            metadata: { content: message, segment: userSegment }
          });

          await eventRepo.create({
            conversationId: conversation.id,
            type: "WHATSAPP_RESPONSE",
            metadata: { 
              content: result.text, 
              model: modelUsed,
              tokens: result.tokensUsed,
              responseTimeMs: responseTime
            }
          });

          const cost = result.tokensUsed * 0.0001;

          return {
            response: truncateResponse(result.text, 300),
            source: modelUsed,
            responseTimeMs: responseTime,
            tokensUsed: result.tokensUsed,
            cost: cost.toFixed(6),
            remainingDaily: limitCheck.remaining
          };
        } catch (geminiError: any) {
          fallbackAttempted = true;
          console.warn("⚠️ Gemini failed, trying DeepSeek...");

          try {
            modelUsed = "deepseek";
            const deepseekAdapter = new DeepSeekAdapter(env.DEEPSEEK_API_KEY);
            const result = await deepseekAdapter.generateResponse({
              message,
              history: [],
              context: { stage: userSegment, trustLevel: conversation.trustLevel },
              constitutionId: "alex-whatsapp-optimizer"
            });

            const responseTime = Date.now() - startTime;
            const cost = result.tokensUsed * 0.0002;

            return {
              response: truncateResponse(result.text, 300),
              source: modelUsed,
              fallback: true,
              responseTimeMs: responseTime,
              tokensUsed: result.tokensUsed,
              cost: cost.toFixed(6)
            };
          } catch (deepseekError: any) {
            fallbackAttempted = true;
            console.warn("⚠️ DeepSeek failed, trying ChatGPT Mini...");

            try {
              modelUsed = "gpt-mini";
              const openaiAdapter = new OpenAIAdapter(env.OPENAI_API_KEY);
              const result = await openaiAdapter.generateResponse({
                message,
                history: [],
                context: { stage: userSegment, trustLevel: conversation.trustLevel },
                constitutionId: "alex-whatsapp-optimizer"
              });

              const responseTime = Date.now() - startTime;
              const cost = result.tokensUsed * 0.00005;

              return {
                response: truncateResponse(result.text, 300),
                source: modelUsed,
                fallback: true,
                responseTimeMs: responseTime,
                tokensUsed: result.tokensUsed,
                cost: cost.toFixed(6)
              };
            } catch (finalError: any) {
              return reply.status(503).send({
                error: "Todos los modelos fallaron",
                message: "Intenta más tarde"
              });
            }
          }
        }
      } catch (err: any) {
        request.log.error(err);
        return reply.status(500).send({ error: "WhatsApp Chat Error", message: err.message });
      }
    });

    function truncateResponse(text: string, maxLength: number): string {
      if (text.length <= maxLength) return text;
      return text.substring(0, maxLength - 3) + "...";
    }

    app.get("/whatsapp/metrics", async (request, reply) => {
      await apiKeyAuth(request, reply, env.API_KEY);
      
      const allConversations = await conversationRepo.findAll();
      const waConvos = allConversations.filter(c => c.userId.startsWith("wa_"));
      
      let totalMessages = 0;
      let totalCost = 0;
      let modelUsage = { "gemini-flash": 0, deepseek: 0, "gpt-mini": 0, "rule-based": 0 };

      for (const conv of waConvos) {
        const events = await eventRepo.findByConversation(conv.id);
        const responses = events.filter(e => e.type === "WHATSAPP_RESPONSE");
        totalMessages += responses.length;
        
        responses.forEach(e => {
          const meta = e.metadata as any;
          totalCost += meta.tokens * 0.0001;
          if (meta.model) {
            modelUsage[meta.model as keyof typeof modelUsage] = 
              (modelUsage[meta.model as keyof typeof modelUsage] || 0) + 1;
          }
        });
      }

      const totalResponses = modelUsage["gemini-flash"] + modelUsage.deepseek + modelUsage["gpt-mini"];
      const fallbackRate = totalResponses > 0 
        ? ((modelUsage.deepseek + modelUsage["gpt-mini"]) / totalResponses).toFixed(2)
        : "0";

      return {
        totalUsers: waConvos.length,
        totalMessages,
        totalCost: totalCost.toFixed(4),
        avgCostPerMessage: totalMessages > 0 ? (totalCost / totalMessages).toFixed(4) : "0",
        modelUsage,
        fallbackRate: (parseFloat(fallbackRate) * 100) + "%",
        targetFallbackRate: "10%"
      };
    });

    app.get("/whatsapp/usage/:userId", async (request, reply) => {
      await apiKeyAuth(request, reply, env.API_KEY);
      const { userId } = request.params as { userId: string };

      const tracker = userCostTracker.get(userId);
      if (!tracker) {
        return { userId, dailyTokens: 0, monthlyTokens: 0, remaining: WHATSAPP_TOKEN_LIMITS.maxTokensDaily };
      }

      return {
        userId,
        dailyTokens: tracker.dailyTokens,
        monthlyTokens: tracker.monthlyTokens,
        remaining: WHATSAPP_TOKEN_LIMITS.maxTokensDaily - tracker.dailyTokens,
        limit: WHATSAPP_TOKEN_LIMITS.maxTokensDaily
      };
    });

    app.post("/cerebro/consensus", async (request, reply) => {
      try {
        await apiKeyAuth(request, reply, env.API_KEY);
        const { content, schemas, minConsensus = 2 } = request.body as {
          content: string;
          schemas: string[];
          minConsensus?: number;
        };

        if (!content || !schemas) {
          return reply.status(400).send({ error: "Missing content or schemas" });
        }

        const constitution = constitutionManager.get("alex-cerebro-labeling");
        const responses = [];

        for (let i = 0; i < minConsensus; i++) {
          const llmProvider = llmRouter;
          const result = await (llmProvider as any).generateResponse({
            message: `ETIQUETAR (votación ${i + 1}/${minConsensus}): ${content}`,
            history: [],
            context: { stage: "consensus", trustLevel: 100 },
            constitutionId: "alex-cerebro-labeling"
          });

          try {
            responses.push(JSON.parse(result.text));
          } catch {
            responses.push({ raw: result.text });
          }
        }

        const merged = responses.reduce((acc: any, r: any) => {
          if (r.labels) {
            for (const [schema, label] of Object.entries(r.labels)) {
              if (!acc[schema]) acc[schema] = [];
              acc[schema].push(label);
            }
          }
          return acc;
        }, {});

        const finalLabels: any = {};
        const consensusResults: any = {};

        for (const [schema, labels] of Object.entries(merged)) {
          const labelArray = labels as string[];
          const mostCommon = labelArray.sort((a, b) =>
            labelArray.filter(v => v === b).length - labelArray.filter(v => v === a).length
          )[0];
          const agreement = labelArray.filter(v => v === mostCommon).length / labelArray.length;
          
          finalLabels[schema] = mostCommon;
          consensusResults[schema] = {
            label: mostCommon,
            agreement: agreement,
            votes: labelArray
          };
        }

        return {
          content,
          finalLabels,
          consensusResults,
          consensusRate: Object.values(consensusResults).every((r: any) => r.agreement >= 0.5) ? "achieved" : "partial",
          responsesCount: minConsensus,
          tokensUsed: responses.reduce((sum: number, r: any) => sum + (r.tokensUsed || 0), 0)
        };
      } catch (err: any) {
        request.log.error(err);
        return reply.status(500).send({ error: "Consensus Error", message: err.message });
      }
    });

    app.get("/cerebro/metrics", async (request, reply) => {
      await apiKeyAuth(request, reply, env.API_KEY);
      
      const events = await eventRepo.findByConversation("cerebro");
      const tasks = events.filter(e => e.type === "TASK_COMPLETED");
      
      if (tasks.length === 0) {
        return {
          totalTasks: 0,
          avgResponseTime: 0,
          avgConfidence: 0,
          totalCost: 0,
          totalTokens: 0
        };
      }

      const metadata = tasks.map(e => e.metadata as any);
      const avgResponseTime = metadata.reduce((sum, m) => sum + (m.responseTimeMs || 0), 0) / metadata.length;
      const avgConfidence = metadata.reduce((sum, m) => sum + (m.confidence || 0), 0) / metadata.length;
      const totalCost = metadata.reduce((sum, m) => sum + (m.cost || 0), 0);
      const totalTokens = metadata.reduce((sum, m) => sum + (m.tokensUsed || 0), 0);

      return {
        totalTasks: tasks.length,
        avgResponseTime: Math.round(avgResponseTime),
        avgConfidence: (avgConfidence * 100).toFixed(1) + "%",
        totalCost: totalCost.toFixed(4),
        totalTokens,
        costPerLabel: (totalCost / tasks.length).toFixed(4)
      };
    });

    app.get("/brain/timeline/:userId", async (request, reply) => {
      await apiKeyAuth(request, reply, env.API_KEY);
      const { userId } = request.params as { userId: string };

      const conversation = await conversationRepo.findByUserId(userId);
      if (!conversation) return reply.status(404).send({ error: "Conversation not found" });

      const events = await eventRepo.findByConversation(conversation.id);
      return { conversation, events };
    });

    app.get("/dashboard/:userId", async (request, reply) => {
      const { userId } = request.params as { userId: string };
      const conversation = await conversationRepo.findByUserId(userId);
      if (!conversation) return reply.status(404).send("Conversation not found");

      const events = await eventRepo.findByConversation(conversation.id);

      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <title>Alex Azul Dashboard - ${userId}</title>
          <style>
            body { font-family: sans-serif; padding: 20px; background: #f0f2f5; }
            .card { background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
            .event { border-left: 4px solid #007bff; padding-left: 10px; margin-bottom: 10px; }
            .event-type { font-weight: bold; color: #007bff; }
            .metadata { font-size: 0.9em; color: #666; }
            .metric { display: inline-block; margin-right: 20px; }
            .metric-value { font-size: 1.5em; font-weight: bold; }
          </style>
        </head>
        <body>
          <h1>Alex Azul Dashboard</h1>
          <div class="card">
            <h2>Estado Actual: ${userId}</h2>
            <div class="metric"><div class="metric-value">${conversation.currentScore}</div><div>Score</div></div>
            <div class="metric"><div class="metric-value">${conversation.stage}</div><div>Stage</div></div>
            <div class="metric"><div class="metric-value">${conversation.trustLevel}%</div><div>Trust</div></div>
            <div class="metric"><div class="metric-value">$${conversation.conversationCost.toFixed(4)}</div><div>Cost</div></div>
          </div>
          <div class="card">
            <h2>Timeline de Eventos (Memory Layer v2)</h2>
            ${events.map(e => `
              <div class="event">
                <div class="event-type">${e.type}</div>
                <div class="metadata">${JSON.stringify(e.metadata)}</div>
                <div class="metadata">${new Date(e.createdAt).toLocaleString()}</div>
              </div>
            `).join('')}
          </div>
        </body>
        </html>
      `;
      reply.type("text/html").send(html);
    });

    // === WHATSAPP COMPLETO - Webhook, CRM, Sentimiento, Transferencia ===

    app.post("/whatsapp/webhook", async (request, reply) => {
      const { entry } = request.body as any;
      
      if (!entry || !entry[0]?.changes) {
        return reply.status(200).send({ status: "ok" });
      }

      const changes = entry[0].changes;
      for (const change of changes) {
        if (!change.value?.messages) continue;
        
        for (const msg of change.value.messages) {
          const phone = msg.from;
          const text = msg.text?.body || "";
          
          let lead = whatsappManager.getLead(phone);
          if (!lead) {
            lead = whatsappManager.createLead(phone, "whatsapp_webhook");
          }
          
          whatsappManager.updateLeadField(phone, "messagesCount", (lead?.messagesCount || 0) + 1);

          const sentiment = whatsappManager.analyzeSentiment(text);
          
          if (whatsappManager.shouldEscalate(text) || whatsappManager.shouldTransferToHuman(text)) {
            console.log(`⚠️ Escalando conversación de ${phone}`);
            await eventRepo.create({
              conversationId: "whatsapp",
              type: "ESCALATION_TRIGGERED",
              metadata: { phone, message: text, sentiment }
            });
          }
        }
      }

      return reply.status(200).send({ status: "received" });
    });

    app.get("/whatsapp/webhook", async (request, reply) => {
      const { "hub.mode": mode, "hub.verify_token": token, "hub.challenge": challenge } = request.query as any;
      
      const VERIFY_TOKEN = env.API_KEY;
      
      if (mode === "subscribe" && token === VERIFY_TOKEN) {
        return reply.status(200).send(challenge);
      }
      
      return reply.status(403).send({ error: "Invalid token" });
    });

    app.post("/whatsapp/analyze", async (request, reply) => {
      try {
        await apiKeyAuth(request, reply, env.API_KEY);
        const { message } = request.body as { message: string };

        const sentiment = whatsappManager.analyzeSentiment(message);
        const template = whatsappManager.matchTemplate(message);
        const shouldEscalate = whatsappManager.shouldEscalate(message);
        const shouldTransfer = whatsappManager.shouldTransferToHuman(message);

        return {
          sentiment,
          matchedTemplate: template?.category || null,
          shouldEscalate,
          shouldTransfer
        };
      } catch (err: any) {
        return reply.status(500).send({ error: "Analysis Error", message: err.message });
      }
    });

    app.post("/whatsapp/lead", async (request, reply) => {
      try {
        await apiKeyAuth(request, reply, env.API_KEY);
        const { phone, name, email, interest, budget, source = "whatsapp" } = request.body as {
          phone: string;
          name?: string;
          email?: string;
          interest?: string;
          budget?: string;
          source?: string;
        };

        let lead = whatsappManager.getLead(phone);
        if (lead) {
          lead = whatsappManager.updateLead(phone, {
            name: name || lead.name,
            email: email || lead.email,
            interest: interest || lead.interest,
            budget: budget || lead.budget,
            status: "qualified"
          })!;
        } else {
          lead = whatsappManager.createLead(phone, source);
          lead.name = name;
          lead.email = email;
          lead.interest = interest;
          lead.budget = budget;
          lead.status = "qualified";
        }

        return {
          success: true,
          lead: {
            id: lead.id,
            phone: lead.phone,
            name: lead.name,
            status: lead.status
          }
        };
      } catch (err: any) {
        return reply.status(500).send({ error: "Lead Error", message: err.message });
      }
    });

    app.get("/whatsapp/leads", async (request, reply) => {
      await apiKeyAuth(request, reply, env.API_KEY);
      const { status, segment } = request.query as { status?: string; segment?: string };

      let leads = whatsappManager.getAllLeads();
      
      if (status) {
        leads = leads.filter(l => l.status === status);
      }
      if (segment) {
        leads = leads.filter(l => l.segment === segment);
      }

      return {
        total: leads.length,
        leads: leads.map(l => ({
          id: l.id,
          phone: l.phone,
          name: l.name,
          email: l.email,
          status: l.status,
          segment: l.segment,
          messagesCount: l.messagesCount,
          lastInteraction: l.lastInteraction
        }))
      };
    });

    app.get("/whatsapp/leads/report", async (request, reply) => {
      await apiKeyAuth(request, reply, env.API_KEY);
      return whatsappManager.generateLeadReport();
    });

    app.post("/whatsapp/lead/:phone/convert", async (request, reply) => {
      try {
        await apiKeyAuth(request, reply, env.API_KEY);
        const { phone } = request.params as { phone: string };
        
        const lead = whatsappManager.updateLead(phone, {
          status: "converted",
          segment: "cliente_activo"
        });

        if (!lead) {
          return reply.status(404).send({ error: "Lead no encontrado" });
        }

        return { success: true, lead };
      } catch (err: any) {
        return reply.status(500).send({ error: "Convert Error", message: err.message });
      }
    });

    app.post("/whatsapp/transfer", async (request, reply) => {
      try {
        await apiKeyAuth(request, reply, env.API_KEY);
        const { phone, reason, priority = "normal" } = request.body as {
          phone: string;
          reason: string;
          priority?: "normal" | "high" | "urgent";
        };

        const transfer = {
          id: `transfer_${Date.now()}`,
          phone,
          reason,
          priority,
          status: "pending",
          createdAt: new Date().toISOString(),
          assignedTo: null
        };

        await eventRepo.create({
          conversationId: "whatsapp",
          type: "TRANSFER_TO_HUMAN",
          metadata: transfer
        });

        return {
          success: true,
          transfer,
          message: priority === "urgent" 
            ? "¡Urgente! Ticket creado. Un agente te contactará inmediatamente."
            : "He derivado tu caso a un agente. Te contactarán pronto."
        };
      } catch (err: any) {
        return reply.status(500).send({ error: "Transfer Error", message: err.message });
      }
    });

    app.get("/whatsapp/templates", async (request, reply) => {
      await apiKeyAuth(request, reply, env.API_KEY);
      return {
        categories: ["greetings", "support", "sales", "followup"],
        templates: whatsappManager["templates"]?.templates || {}
      };
    });

    // === BITRIX24 CRM INTEGRATION ===

    let bitrixClient: Bitrix24Client | null = null;

    app.post("/bitrix/configure", async (request, reply) => {
      try {
        await apiKeyAuth(request, reply, env.API_KEY);
        const { webhookUrl } = request.body as { webhookUrl: string };

        if (!webhookUrl) {
          return reply.status(400).send({ error: "Missing webhookUrl" });
        }

        bitrixClient = new Bitrix24Client(webhookUrl);

        return {
          success: true,
          message: "Bitrix24 configurado correctamente"
        };
      } catch (err: any) {
        return reply.status(500).send({ error: "Bitrix Config Error", message: err.message });
      }
    });

    app.post("/bitrix/lead", async (request, reply) => {
      try {
        await apiKeyAuth(request, reply, env.API_KEY);
        
        if (!bitrixClient) {
          return reply.status(400).send({ error: "Bitrix24 no configurado. POST /bitrix/configure primero" });
        }

        const { 
          name, 
          phone, 
          email, 
          title = "Lead de WhatsApp",
          interest,
          budget,
          comments 
        } = request.body as {
          name?: string;
          phone?: string;
          email?: string;
          title?: string;
          interest?: string;
          budget?: string;
          comments?: string;
        };

        const leadData = {
          TITLE: title,
          NAME: name?.split(" ")[0] || "",
          LAST_NAME: name?.split(" ").slice(1).join(" ") || "",
          PHONE: phone ? [{ VALUE: phone, VALUE_TYPE: "WORK" }] : undefined,
          EMAIL: email ? [{ VALUE: email, VALUE_TYPE: "WORK" }] : undefined,
          SOURCE_ID: "16",
          SOURCE_DESCRIPTION: "WhatsApp",
          UF_CRM_INTEREST: interest,
          UF_BUDGET: budget,
          COMMENTS: comments
        };

        const leadId = await bitrixClient.createLead(leadData);

        return {
          success: true,
          leadId,
          message: `Lead #${leadId} creado en Bitrix24`
        };
      } catch (err: any) {
        request.log.error(err);
        return reply.status(500).send({ error: "Bitrix Lead Error", message: err.message });
      }
    });

    app.post("/bitrix/lead/from-whatsapp", async (request, reply) => {
      try {
        await apiKeyAuth(request, reply, env.API_KEY);

        if (!bitrixClient) {
          return reply.status(400).send({ error: "Bitrix24 no configurado" });
        }

        const { phone, name, email, interest, budget } = request.body as {
          phone: string;
          name?: string;
          email?: string;
          interest?: string;
          budget?: string;
        };

        const existingContacts = await bitrixClient.searchContacts(phone);
        
        if (existingContacts.length > 0) {
          const contactId = existingContacts[0].ID;
          
          const leadData = {
            TITLE: `Lead de WhatsApp - ${name || phone}`,
            NAME: name?.split(" ")[0] || "",
            LAST_NAME: name?.split(" ").slice(1).join(" ") || "",
            PHONE: [{ VALUE: phone, VALUE_TYPE: "WORK" }],
            CONTACT_ID: contactId.toString(),
            SOURCE_ID: "16",
            UF_CRM_INTEREST: interest,
            UF_BUDGET: budget
          };

          const leadId = await bitrixClient.createLead(leadData);

          return {
            success: true,
            leadId,
            contactId,
            message: "Lead creado y vinculado a contacto existente"
          };
        }

        const leadData = {
          TITLE: `Lead de WhatsApp - ${name || phone}`,
          NAME: name?.split(" ")[0] || "",
          LAST_NAME: name?.split(" ").slice(1).join(" ") || "",
          PHONE: phone ? [{ VALUE: phone, VALUE_TYPE: "WORK" }] : undefined,
          EMAIL: email ? [{ VALUE: email, VALUE_TYPE: "WORK" }] : undefined,
          SOURCE_ID: "16",
          UF_CRM_INTEREST: interest,
          UF_BUDGET: budget
        };

        const leadId = await bitrixClient.createLead(leadData);

        return {
          success: true,
          leadId,
          message: "Nuevo lead creado en Bitrix24"
        };
      } catch (err: any) {
        request.log.error(err);
        return reply.status(500).send({ error: "Bitrix Lead Error", message: err.message });
      }
    });

    app.get("/bitrix/leads", async (request, reply) => {
      try {
        await apiKeyAuth(request, reply, env.API_KEY);

        if (!bitrixClient) {
          return reply.status(400).send({ error: "Bitrix24 no configurado" });
        }

        const { status, limit = "50" } = request.query as { status?: string; limit?: string };
        
        const filter: any = {};
        if (status) {
          filter.STATUS_ID = status;
        }

        const leads = await bitrixClient.listLeads(filter, { limit: parseInt(limit || "50") });

        return {
          total: leads.length,
          leads: leads.map(l => ({
            id: l.ID,
            title: l.TITLE,
            name: l.NAME,
            phone: l.PHONE?.[0]?.VALUE,
            email: l.EMAIL?.[0]?.VALUE,
            status: l.STATUS_ID,
            created: l.DATE_CREATE
          }))
        };
      } catch (err: any) {
        return reply.status(500).send({ error: "Bitrix Leads Error", message: err.message });
      }
    });

    app.get("/bitrix/test", async (request, reply) => {
      try {
        await apiKeyAuth(request, reply, env.API_KEY);

        if (!bitrixClient) {
          return reply.status(400).send({ 
            configured: false, 
            message: "Debes configurar con POST /bitrix/configure" 
          });
        }

        const test = await bitrixClient.call("crm.status.list", {
          filter: { ENTITY_ID: "STATUS" }
        });

        return {
          configured: true,
          test: "OK",
          message: "Conexión con Bitrix24 exitosa"
        };
      } catch (err: any) {
        return reply.status(500).send({ 
          configured: false, 
          error: err.message 
        });
      }
    });

    // === MULTI-TENANT MANAGEMENT ===

    app.post("/tenant", async (request, reply) => {
      try {
        await apiKeyAuth(request, reply, env.API_KEY);
        const { 
          name, 
          slug, 
          constitutionId = "conversational-programming",
          limits
        } = request.body as {
          name: string;
          slug: string;
          constitutionId?: string;
          limits?: { dailyTokens?: number; maxTokensPerResponse?: number; maxInteractions?: number };
        };

        if (!name || !slug) {
          return reply.status(400).send({ error: "Missing name or slug" });
        }

        const existing = tenantManager.getTenantBySlug(slug);
        if (existing) {
          return reply.status(400).send({ error: "Slug ya existe" });
        }

        const tenant = tenantManager.createTenant({
          name,
          slug,
          constitutionId,
          limits: limits ? { dailyTokens: limits.dailyTokens || 1000, maxTokensPerResponse: limits.maxTokensPerResponse || 150, maxInteractions: limits.maxInteractions || 100 } : { dailyTokens: 1000, maxTokensPerResponse: 150, maxInteractions: 100 },
          settings: {},
          active: true
        });

        return { success: true, tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug, constitutionId: tenant.constitutionId } };
      } catch (err: any) {
        return reply.status(500).send({ error: "Tenant Error", message: err.message });
      }
    });

    app.get("/tenant", async (request, reply) => {
      await apiKeyAuth(request, reply, env.API_KEY);
      const tenants = tenantManager.getAllTenants();
      return { total: tenants.length, tenants: tenants.map(t => ({ id: t.id, name: t.name, slug: t.slug, constitution: t.constitutionId, active: t.active })) };
    });

    app.get("/tenant/:slug", async (request, reply) => {
      await apiKeyAuth(request, reply, env.API_KEY);
      const { slug } = request.params as { slug: string };
      const stats = tenantManager.getTenantStats(slug);
      if (!stats) return reply.status(404).send({ error: "Tenant no encontrado" });
      return stats;
    });

    app.put("/tenant/:slug", async (request, reply) => {
      try {
        await apiKeyAuth(request, reply, env.API_KEY);
        const { slug } = request.params as { slug: string };
        const { name, constitutionId, limits, active } = request.body as { name?: string; constitutionId?: string; limits?: { dailyTokens?: number; maxTokensPerResponse?: number; maxInteractions?: number }; active?: boolean };
        const tenant = tenantManager.getTenantBySlug(slug);
        if (!tenant) return reply.status(404).send({ error: "Tenant no encontrado" });
        const updated = tenantManager.updateTenant(tenant.id, { name: name || tenant.name, constitutionId: constitutionId || tenant.constitutionId, limits: limits ? { ...tenant.limits, ...limits } : tenant.limits, active: active !== undefined ? active : tenant.active });
        return { success: true, tenant: updated };
      } catch (err: any) {
        return reply.status(500).send({ error: "Update Error", message: err.message });
      }
    });

    app.delete("/tenant/:slug", async (request, reply) => {
      try {
        await apiKeyAuth(request, reply, env.API_KEY);
        const { slug } = request.params as { slug: string };
        const tenant = tenantManager.getTenantBySlug(slug);
        if (!tenant) return reply.status(404).send({ error: "Tenant no encontrado" });
        const deleted = tenantManager.deleteTenant(tenant.id);
        return { success: deleted };
      } catch (err: any) {
        return reply.status(500).send({ error: "Delete Error", message: err.message });
      }
    });

    app.post("/tenant/:slug/constitution", async (request, reply) => {
      try {
        await apiKeyAuth(request, reply, env.API_KEY);
        const { slug } = request.params as { slug: string };
        const { constitutionId } = request.body as { constitutionId: string };
        const tenant = tenantManager.getTenantBySlug(slug);
        if (!tenant) return reply.status(404).send({ error: "Tenant no encontrado" });
        const constitutions = constitutionManager.getAll();
        const exists = constitutions.find(c => c.id === constitutionId);
        if (!exists) return reply.status(400).send({ error: "Constitution no encontrada" });
        tenantManager.setDefaultConstitution(tenant.id, constitutionId);
        return { success: true, constitutionId };
      } catch (err: any) {
        return reply.status(500).send({ error: "Constitution Error", message: err.message });
      }
    });

    app.post("/tenant/:slug/whatsapp", async (request, reply) => {
      try {
        await apiKeyAuth(request, reply, env.API_KEY);
        const { slug } = request.params as { slug: string };
        const { phoneNumberId, accessToken } = request.body as { phoneNumberId: string; accessToken: string };
        const tenant = tenantManager.getTenantBySlug(slug);
        if (!tenant) return reply.status(404).send({ error: "Tenant no encontrado" });
        tenantManager.configureWhatsApp(tenant.id, { phoneNumberId, accessToken });
        return { success: true, message: "WhatsApp configurado" };
      } catch (err: any) {
        return reply.status(500).send({ error: "WhatsApp Config Error", message: err.message });
      }
    });

    app.post("/tenant/:slug/bitrix", async (request, reply) => {
      try {
        await apiKeyAuth(request, reply, env.API_KEY);
        const { slug } = request.params as { slug: string };
        const { webhookUrl } = request.body as { webhookUrl: string };
        const tenant = tenantManager.getTenantBySlug(slug);
        if (!tenant) return reply.status(404).send({ error: "Tenant no encontrado" });
        tenantManager.configureBitrix(tenant.id, webhookUrl);
        return { success: true, message: "Bitrix24 configurado" };
      } catch (err: any) {
        return reply.status(500).send({ error: "Bitrix Config Error", message: err.message });
      }
    });

    app.get("/tenant/:slug/bitrix/test", async (request, reply) => {
      try {
        await apiKeyAuth(request, reply, env.API_KEY);
        const { slug } = request.params as { slug: string };
        const tenant = tenantManager.getTenantBySlug(slug);
        if (!tenant || !tenant.bitrix?.webhookUrl) return reply.status(400).send({ error: "Bitrix no configurado" });
        const bitrix = new Bitrix24Client(tenant.bitrix.webhookUrl);
        await bitrix.call("crm.status.list", { filter: { ENTITY_ID: "STATUS" } });
        return { success: true, message: "Conexión Bitrix24 OK" };
      } catch (err: any) {
        return reply.status(500).send({ error: "Test Error", message: err.message });
      }
    });

    app.post("/tenant/:slug/chat", async (request, reply) => {
      try {
        const { slug } = request.params as { slug: string };
        const { userId, message } = request.body as { userId: string; message: string };
        const tenant = tenantManager.getTenantBySlug(slug);
        if (!tenant) return reply.status(404).send({ error: "Tenant no encontrado" });
        if (!tenant.active) return reply.status(403).send({ error: "Tenant inactivo" });
        const conversation = await conversationRepo.findOrCreate(`${slug}_${userId}`);
        const recentEvents = await eventRepo.findByConversation(conversation.id);
        const history = recentEvents.filter(e => e.type === "MESSAGE" || e.type === "ASSISTANT_RESPONSE").slice(-10).map(e => ({ role: e.type === "MESSAGE" ? "user" : "assistant", content: (e.metadata as any).content }));
        const result = await (llmRouter as any).generateResponse({ message, history, context: { stage: conversation.stage, trustLevel: conversation.trustLevel }, constitutionId: tenant.constitutionId });
        await eventRepo.create({ conversationId: conversation.id, type: "MESSAGE", metadata: { content: message, tenant: slug } });
        await eventRepo.create({ conversationId: conversation.id, type: "ASSISTANT_RESPONSE", metadata: { content: result.text, tenant: slug } });
        return { tenant: slug, response: result.text, tokensUsed: result.tokensUsed };
      } catch (err: any) {
        request.log.error(err);
        return reply.status(500).send({ error: "Chat Error", message: err.message });
      }
    });

    app.post("/tenant/:slug/lead", async (request, reply) => {
      try {
        await apiKeyAuth(request, reply, env.API_KEY);
        const { slug } = request.params as { slug: string };
        const { name, phone, email, interest, budget } = request.body as { name?: string; phone?: string; email?: string; interest?: string; budget?: string };
        const tenant = tenantManager.getTenantBySlug(slug);
        if (!tenant || !tenant.bitrix?.webhookUrl) return reply.status(400).send({ error: "Tenant o Bitrix no configurado" });
        const bitrix = new Bitrix24Client(tenant.bitrix.webhookUrl);
        const leadId = await bitrix.createLead({ TITLE: `Lead de ${tenant.name} - ${name || phone}`, NAME: name?.split(" ")[0] || "", LAST_NAME: name?.split(" ").slice(1).join(" ") || "", PHONE: phone ? [{ VALUE: phone, VALUE_TYPE: "WORK" }] : undefined, EMAIL: email ? [{ VALUE: email, VALUE_TYPE: "WORK" }] : undefined, SOURCE_ID: "16", SOURCE_DESCRIPTION: `WhatsApp - ${tenant.name}`, UF_CRM_INTEREST: interest, UF_BUDGET: budget });
        await eventRepo.create({ conversationId: slug, type: "LEAD_CREATED", metadata: { leadId, tenant: slug, name, phone } });
        return { success: true, leadId, tenant: slug };
      } catch (err: any) {
        request.log.error(err);
        return reply.status(500).send({ error: "Lead Error", message: err.message });
      }
    });

    await app.listen({ port: env.PORT, host: "0.0.0.0" });
    console.log(`🚀 Alex Azul v1 running on port ${env.PORT}`);

  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

bootstrap();
