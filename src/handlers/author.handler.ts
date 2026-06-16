import { Context } from "telegraf";
import { messages } from "../bot/messages";
import { resetSession, setSession } from "../bot/sessionStore";
import { logger } from "../utils/logger";
import { replySafely } from "../utils/telegram";

export async function handleAuthor(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) {
    await replySafely(ctx, messages.genericStartFlow);
    return;
  }

  resetSession(userId);
  setSession(userId, { state: "waiting_title", postType: "author" });
  logger.info("/author started by user id", { userId });
  await replySafely(ctx, messages.askAuthorTitle, { userId });
}
