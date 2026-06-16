import { Context } from "telegraf";
import { logger } from "./logger";

const TELEGRAM_REPLY_TIMEOUT_MS = 15000;

function timeout(ms: number, onTimeout: () => void): { promise: Promise<never>; clear: () => void } {
  let timeoutId: NodeJS.Timeout | undefined;
  const promise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      onTimeout();
      reject(new Error(`Telegram reply timed out after ${ms} milliseconds`));
    }, ms);
  });

  return {
    promise,
    clear: () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  };
}

function logLateReplyFailure(reply: Promise<unknown>, logContext: Record<string, unknown>): void {
  reply.catch((error: unknown) => {
    const reason = error instanceof Error ? error.message : "Unknown Telegram reply error";
    logger.error("Telegram reply settled after timeout", { ...logContext, reason });
  });
}

export async function replySafely(ctx: Context, text: string, logContext: Record<string, unknown> = {}): Promise<boolean> {
  let didTimeout = false;
  const reply = ctx.reply(text);
  const replyTimeout = timeout(TELEGRAM_REPLY_TIMEOUT_MS, () => {
    didTimeout = true;
  });

  try {
    await Promise.race([reply, replyTimeout.promise]);
    return true;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Unknown Telegram reply error";
    logger.error("Telegram reply failed", { ...logContext, reason });
    return false;
  } finally {
    replyTimeout.clear();
    if (didTimeout) {
      logLateReplyFailure(reply, logContext);
    }
  }
}
