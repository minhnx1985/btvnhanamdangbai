import dotenv from "dotenv";
import { AppError } from "../utils/errors";

dotenv.config();

type NodeEnv = "development" | "production" | "test";

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new AppError(`Missing required environment variable: ${name}`, "ENV_VALIDATION_ERROR");
  }

  return value;
}

function parsePort(rawPort: string | undefined): number {
  const value = rawPort?.trim() ?? "3000";
  const port = Number(value);

  if (!Number.isInteger(port) || port <= 0) {
    throw new AppError("PORT must be a positive integer", "ENV_VALIDATION_ERROR");
  }

  return port;
}

function parseNodeEnv(rawNodeEnv: string | undefined): NodeEnv {
  const value = rawNodeEnv?.trim() ?? "development";
  if (value === "development" || value === "production" || value === "test") {
    return value;
  }

  throw new AppError("NODE_ENV must be development, production, or test", "ENV_VALIDATION_ERROR");
}

function parseAllowedUserIds(rawValue: string | undefined): number[] {
  const input = rawValue?.trim();
  if (!input) {
    return [];
  }

  const ids = input
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => Number(item));

  if (ids.length === 0 || ids.some((id) => !Number.isInteger(id))) {
    throw new AppError("BOT_ALLOWED_USER_IDS must be a comma-separated list of numeric Telegram user IDs", "ENV_VALIDATION_ERROR");
  }

  return ids;
}

export const config = {
  port: parsePort(process.env.PORT),
  nodeEnv: parseNodeEnv(process.env.NODE_ENV),
  telegramBotToken: requireEnv("TELEGRAM_BOT_TOKEN"),
  telegramWebhookUrl: process.env.TELEGRAM_WEBHOOK_URL?.trim() || "",
  sapoBaseUrl: requireEnv("SAPO_BASE_URL"),
  sapoApiKey: requireEnv("SAPO_API_KEY"),
  sapoApiSecret: requireEnv("SAPO_API_SECRET"),
  sapoDefaultBlogName: process.env.SAPO_DEFAULT_BLOG_NAME?.trim() || "Biên tập viên giới thiệu",
  allowedUserIds: parseAllowedUserIds(process.env.BOT_ALLOWED_USER_IDS)
} as const;

export type AppConfig = typeof config;
