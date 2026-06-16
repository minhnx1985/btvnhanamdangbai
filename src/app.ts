import express, { Express, Request, Response } from "express";
import { Telegraf } from "telegraf";
import { logger } from "./utils/logger";

const UPDATE_DEDUPE_TTL_MS = 10 * 60 * 1000;
const handledUpdateIds = new Map<number, number>();

function getUpdateId(body: unknown): number | undefined {
  if (!body || typeof body !== "object" || !("update_id" in body)) {
    return undefined;
  }

  const updateId = (body as { update_id?: unknown }).update_id;
  return typeof updateId === "number" ? updateId : undefined;
}

function pruneHandledUpdateIds(now: number): void {
  for (const [updateId, expiresAt] of handledUpdateIds.entries()) {
    if (expiresAt <= now) {
      handledUpdateIds.delete(updateId);
    }
  }
}

function shouldProcessUpdate(updateId: number | undefined): boolean {
  if (updateId === undefined) {
    return true;
  }

  const now = Date.now();
  pruneHandledUpdateIds(now);

  if (handledUpdateIds.has(updateId)) {
    return false;
  }

  handledUpdateIds.set(updateId, now + UPDATE_DEDUPE_TTL_MS);
  return true;
}

export function createApp(bot: Telegraf): Express {
  const app = express();

  app.use(express.json());

  app.get("/health", (_req: Request, res: Response) => {
    res.json({ ok: true });
  });

  app.post("/telegram/webhook", (req: Request, res: Response) => {
    const updateId = getUpdateId(req.body);
    res.sendStatus(200);

    if (!shouldProcessUpdate(updateId)) {
      logger.warn("Telegram duplicate update skipped", { updateId });
      return;
    }

    void bot.handleUpdate(req.body).catch((error: unknown) => {
      const reason = error instanceof Error ? error.message : "Unknown error";
      logger.error("Telegram update processing failed", { updateId, reason });
    });
  });

  logger.info("webhook path registered", { path: "/telegram/webhook" });
  return app;
}
