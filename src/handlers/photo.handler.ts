import { Context } from "telegraf";
import { messages } from "../bot/messages";
import { getSession, resetSession, setSession } from "../bot/sessionStore";
import { compressImageUnder1MB } from "../services/image.service";
import { downloadTelegramPhoto } from "../services/telegram-file.service";
import { logger } from "../utils/logger";
import { replySafely } from "../utils/telegram";
import { submitDraftPost } from "./text.handler";

type PhotoContext = Context & {
  message: {
    photo?: Array<{ file_id: string; file_unique_id: string; width: number; height: number; file_size?: number }>;
  };
};

export async function handlePhotoMessage(ctx: PhotoContext): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) {
    await replySafely(ctx, messages.genericStartFlow);
    return;
  }

  const session = getSession(userId);

  if (session.state === "idle") {
    await replySafely(ctx, messages.genericStartFlow, { userId });
    return;
  }

  if (session.state === "waiting_title") {
    await replySafely(ctx, messages.waitTitleText, { userId });
    return;
  }

  if (session.state === "waiting_content" && !session.content) {
    await replySafely(ctx, messages.waitContentText, { userId });
    return;
  }

  if (session.state === "waiting_product_link") {
    await replySafely(ctx, messages.waitProductLinkText, { userId });
    return;
  }

  if (session.state === "waiting_keywords") {
    await replySafely(ctx, messages.waitKeywordsText, { userId });
    return;
  }

  if (session.state !== "waiting_image" && session.state !== "waiting_content") {
    await replySafely(ctx, messages.genericStartFlow, { userId });
    return;
  }

  if (!session.title || !session.content) {
    resetSession(userId);
    await replySafely(ctx, "❌ Tạo bài nháp thất bại: Lỗi hệ thống, vui lòng thử lại", { userId });
    return;
  }

  try {
    const inputBuffer = await downloadTelegramPhoto(ctx);
    const processedImage = await compressImageUnder1MB(inputBuffer);

    logger.info("image processed size", {
      userId,
      sizeBytes: processedImage.sizeBytes,
      postType: session.postType ?? "blog"
    });

    if ((session.postType ?? "blog") === "author") {
      await submitDraftPost(ctx, userId, {
        title: session.title,
        content: session.content,
        imageBase64: processedImage.base64,
        imageMimeType: processedImage.mimeType,
        postType: "author"
      });
      return;
    }

    const postType = session.postType ?? "blog";
    setSession(userId, {
      state: "waiting_product_link",
      postType,
      title: session.title,
      content: session.content,
      imageBase64: processedImage.base64,
      imageMimeType: processedImage.mimeType
    });

    await replySafely(ctx, messages.askProductLink, { userId, postType });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Không thể xử lý ảnh dưới 1MB";
    logger.error("photo handler failed", { userId, reason, postType: session.postType ?? "blog" });
    resetSession(userId);
    await replySafely(ctx, `❌ Tạo bài nháp thất bại: ${reason}`, { userId, postType: session.postType ?? "blog" });
  }
}
