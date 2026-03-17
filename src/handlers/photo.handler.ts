import { Context } from "telegraf";
import { messages } from "../bot/messages";
import { getSession, setSession } from "../bot/sessionStore";
import { config } from "../config/env";
import { compressImageUnder1MB } from "../services/image.service";
import { downloadTelegramPhoto } from "../services/telegram-file.service";
import { buildConfirmationPreview } from "./text.handler";
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

  if (session.state === "waiting_content") {
    await ctx.reply(messages.waitContentText);
    return;
  }

  if (session.state === "waiting_confirmation") {
    await ctx.reply(messages.waitConfirmationText);
    return;
  }

  if (session.state !== "waiting_image") {
    await ctx.reply(messages.genericStartFlow);
    return;
  }

  if (!session.title || !session.content) {
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
      state: "waiting_confirmation",
      title: session.title,
      content: session.content,
      imageBase64: processedImage.base64,
      imageMimeType: processedImage.mimeType
    });

    await ctx.reply(buildConfirmationPreview(session.title, session.content, config.sapoDefaultBlogName));
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Không thể xử lý ảnh dưới 1MB";
    logger.error("photo handler failed", { userId, reason });
    await ctx.reply(`❌ Tạo bài nháp thất bại: ${reason}`);
  }
}
