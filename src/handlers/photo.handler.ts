import { Context } from "telegraf";
import { messages } from "../bot/messages";
import { getSession, resetSession, setSession } from "../bot/sessionStore";
import { compressImageUnder1MB } from "../services/image.service";
import { downloadTelegramPhoto } from "../services/telegram-file.service";
import { logger } from "../utils/logger";

type PhotoContext = Context & {
  message: {
    photo?: Array<{ file_id: string; file_unique_id: string; width: number; height: number; file_size?: number }>;
  };
};

export async function handlePhotoMessage(ctx: PhotoContext): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) {
    await ctx.reply(messages.genericStartFlow);
    return;
  }

  const session = getSession(userId);

  if (session.state === "idle") {
    await ctx.reply(messages.genericStartFlow);
    return;
  }

  if (session.state === "waiting_title") {
    await ctx.reply(messages.waitTitleText);
    return;
  }

  if (session.state === "waiting_content" && !session.content) {
    await ctx.reply(messages.waitContentText);
    return;
  }

  if (session.state === "waiting_product_link") {
    await ctx.reply(messages.waitProductLinkText);
    return;
  }

  if (session.state !== "waiting_image" && session.state !== "waiting_content") {
    await ctx.reply(messages.genericStartFlow);
    return;
  }

  if (!session.title || !session.content) {
    resetSession(userId);
    await ctx.reply("❌ Tạo bài nháp thất bại: Lỗi hệ thống, vui lòng thử lại");
    return;
  }

  try {
    const inputBuffer = await downloadTelegramPhoto(ctx);
    const processedImage = await compressImageUnder1MB(inputBuffer);

    logger.info("image processed size", {
      userId,
      sizeBytes: processedImage.sizeBytes
    });

    setSession(userId, {
      state: "waiting_product_link",
      title: session.title,
      content: session.content,
      imageBase64: processedImage.base64,
      imageMimeType: processedImage.mimeType
    });

    await ctx.reply(messages.askProductLink);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Không thể xử lý ảnh dưới 1MB";
    logger.error("photo handler failed", { userId, reason });
    resetSession(userId);
    await ctx.reply(`❌ Tạo bài nháp thất bại: ${reason}`);
  }
}
