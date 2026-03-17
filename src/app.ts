import express, { Express, Request, Response } from "express";
import { Telegraf } from "telegraf";
import { logger } from "./utils/logger";

export function createApp(bot: Telegraf): Express {
  const app = express();

  app.use(express.json());

  app.get("/health", (_req: Request, res: Response) => {
    res.json({ ok: true });
  });

  app.post("/telegram/webhook", async (req: Request, res: Response) => {
    try {
      await bot.handleUpdate(req.body);
      res.sendStatus(200);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Unknown error";
      logger.error("Telegram webhook handling failed", { reason });
      res.sendStatus(500);
    }
  });

  logger.info("webhook path registered", { path: "/telegram/webhook" });
  return app;
}
