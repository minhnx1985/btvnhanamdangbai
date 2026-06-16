import { Context } from "telegraf";
import { messages } from "../bot/messages";
import { replySafely } from "../utils/telegram";

export async function handleStart(ctx: Context): Promise<void> {
  await replySafely(ctx, messages.start, { userId: ctx.from?.id });
}
