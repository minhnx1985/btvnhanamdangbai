import { Context } from "telegraf";
import { messages } from "../bot/messages";
import { resetSession } from "../bot/sessionStore";

export async function handleCancel(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (userId) {
    resetSession(userId);
  }

  await ctx.reply(messages.cancelCurrentAction);
}
