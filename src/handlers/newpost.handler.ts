import { Context } from "telegraf";
import { messages } from "../bot/messages";
import { resetSession, setSession } from "../bot/sessionStore";
import { clearProductLinkAutoSkip } from "../services/product-link-autoskip.service";
import { logger } from "../utils/logger";
import { replySafely } from "../utils/telegram";

export async function handleNewPost(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) {
    await replySafely(ctx, messages.genericStartFlow);
    return;
  }

  clearProductLinkAutoSkip(userId);
  resetSession(userId);
  setSession(userId, { state: "waiting_title", postType: "blog" });
  logger.info("/newpost started by user id", { userId });
  await replySafely(ctx, messages.askTitle, { userId });
}
