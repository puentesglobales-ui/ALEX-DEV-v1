import dotenv from "dotenv";

dotenv.config();

export const env = {
  PORT: parseInt(process.env.PORT || "3000", 10),
  DATABASE_URL: process.env.DATABASE_URL || "",
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || "",
  GEMINI_API_KEY: process.env.GEMINI_API_KEY || "",
  API_KEY: process.env.API_KEY || "supersecretkey",
  COST_PER_1K_TOKENS: parseFloat(process.env.COST_PER_1K_TOKENS || "0.02"),
  BUDGET_THRESHOLD: parseFloat(process.env.BUDGET_THRESHOLD || "10.0"),
  NODE_ENV: process.env.NODE_ENV || "development"
};

export function validateEnv() {
  const required = ["DATABASE_URL", "GEMINI_API_KEY"];
  const missing = required.filter(key => !process.env[key]);
  if (missing.length > 0) {
    console.warn(`⚠️ Warning: Missing environment variables: ${missing.join(", ")}`);
  }
}
