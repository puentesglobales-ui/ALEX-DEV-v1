import Fastify from "fastify";
import rateLimit from "@fastify/rate-limit";
import cors from "@fastify/cors";
import { PrismaClient } from "@prisma/client";
import { env, validateEnv } from "./config/env";
import { apiKeyAuth } from "./middleware/apiKeyAuth";

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

    const prisma = new PrismaClient();
    const conversationRepo = new PrismaConversationRepository(prisma);
    const eventRepo = new PrismaConversationEventRepository(prisma);

    // Configurar Adaptadores
    const claudeAdapter = new ClaudeAdapter(env.CLAUDE_API_KEY);
    const geminiProAdapter = new GeminiAdapter(env.GEMINI_API_KEY, env.GEMINI_MODEL);
    const chatGPTAdapter = new OpenAIAdapter(env.OPENAI_API_KEY);

    // Cadena de Prioridad: Claude (Calidad) -> Gemini Pro -> ChatGPT (Backup)
    const llmRouter = new LLMRouter([
      claudeAdapter,
      geminiProAdapter,
      chatGPTAdapter
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
      await apiKeyAuth(request, reply, env.API_KEY);
      const { userId, message } = request.body as { userId: string; message: string };
      if (!userId || !message) return reply.status(400).send({ error: "Missing userId or message" });

      const result = await generateResponse.execute({ userId, message });
      return result;
    });

    app.post("/brain/tag", async (request, reply) => {
      await apiKeyAuth(request, reply, env.API_KEY);
      const { userId, message } = request.body as { userId: string; message: string };
      if (!userId || !message) return reply.status(400).send({ error: "Missing userId or message" });

      const result = await tagMessage.execute({ userId, message });
      return result;
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

    await app.listen({ port: env.PORT, host: "0.0.0.0" });
    console.log(`🚀 Alex Azul v1 running on port ${env.PORT}`);

  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

bootstrap();
