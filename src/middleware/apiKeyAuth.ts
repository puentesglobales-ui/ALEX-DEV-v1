import { FastifyReply, FastifyRequest } from "fastify";

export async function apiKeyAuth(
  request: FastifyRequest,
  reply: FastifyReply,
  apiKey: string
) {
  const providedKey = request.headers["x-api-key"];

  if (!providedKey || providedKey !== apiKey) {
    reply.status(401).send({ error: "Unauthorized" });
    throw new Error("Unauthorized");
  }
}
