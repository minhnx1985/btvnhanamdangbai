import { Context } from "telegraf";
import { messages } from "../bot/messages";
import { resetSession } from "../bot/sessionStore";
import { clearProductLinkAutoSkip } from "../services/product-link-autoskip.service";
import { replySafely } from "../utils/telegram";

export async function handleCancel(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (userId) {
    clearProductLinkAutoSkip(userId);
    resetSession(userId);
  }

  await replySafely(ctx, messages.cancelCurrentAction, { userId });
}
