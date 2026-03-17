import { Context } from "telegraf";
import { messages } from "../bot/messages";

export async function handleStart(ctx: Context): Promise<void> {
  await ctx.reply(messages.start);
}
