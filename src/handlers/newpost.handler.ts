import { Context } from "telegraf";
import { messages } from "../bot/messages";
import { resetSession, setSession } from "../bot/sessionStore";
import { logger } from "../utils/logger";

export async function handleNewPost(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) {
    await ctx.reply(messages.genericStartFlow);
    return;
  }

  resetSession(userId);
  setSession(userId, { state: "waiting_title" });
  logger.info("/newpost started by user id", { userId });
  await ctx.reply(messages.askTitle);
}
