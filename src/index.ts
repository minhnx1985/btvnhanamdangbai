import { createServer } from "node:http";
import { config } from "./config/env";
import { createApp } from "./app";
import { createBot } from "./bot/createBot";
import { logger } from "./utils/logger";

async function registerWebhook(bot: ReturnType<typeof createBot>): Promise<void> {
  if (!config.telegramWebhookUrl) {
    return;
  }

  const webhookUrl = `${config.telegramWebhookUrl.replace(/\/$/, "")}/telegram/webhook`;
  await bot.telegram.setWebhook(webhookUrl);
  logger.info("Telegram webhook registered", { webhookUrl });
}

async function bootstrap(): Promise<void> {
  const bot = createBot();
  const app = createApp(bot);
  const server = createServer(app);

  server.listen(config.port, async () => {
    logger.info("app started", { port: config.port, nodeEnv: config.nodeEnv });

    if (config.telegramWebhookUrl) {
      await registerWebhook(bot);
      logger.info("bot launched", { mode: "webhook" });
      return;
    }

    if (config.nodeEnv === "development") {
      await bot.launch();
      logger.info("bot launched", { mode: "polling" });
      return;
    }

    logger.warn("bot not launched because TELEGRAM_WEBHOOK_URL is empty outside development mode");
  });

  const shutdown = async (signal: string): Promise<void> => {
    logger.info("received shutdown signal", { signal });
    server.close();
    bot.stop(signal);
    process.exit(0);
  };

  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
}

bootstrap().catch((error: unknown) => {
  const reason = error instanceof Error ? error.message : "Unknown bootstrap error";
  logger.error("app bootstrap failed", { reason });
  process.exit(1);
});
