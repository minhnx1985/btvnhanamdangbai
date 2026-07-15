import { Context } from "telegraf";
import { messages } from "../bot/messages";
import { getSession, resetSession, setSession } from "../bot/sessionStore";
import { compressImageUnder1MB } from "../services/image.service";
import { productLinkCatalogService } from "../services/product-link-catalog.service";
import { scheduleProductLinkAutoSkip } from "../services/product-link-autoskip.service";
import { downloadTelegramPhoto } from "../services/telegram-file.service";
import { ProductLinkCandidate } from "../types/sapo";
import { logger } from "../utils/logger";
import { replySafely } from "../utils/telegram";
import { submitDraftPost, submitDraftPostAfterProductLinkTimeout } from "./text.handler";

type PhotoContext = Context & {
  message: {
    photo?: Array<{ file_id: string; file_unique_id: string; width: number; height: number; file_size?: number }>;
  };
};

const PRODUCT_LINK_AUTO_SKIP_MS = 10000;

function buildProductLinkPrompt(autoProductLinks: ProductLinkCandidate[]): string {
  const lines: string[] = [messages.askProductLink];

  if (autoProductLinks.length > 0) {
    lines.push(
      "",
      "Bot đã tự phát hiện link sản phẩm trong bài:",
      ...autoProductLinks.map((product) => `- ${product.title}: ${product.url}`)
    );
  }

  lines.push(
    "",
    "Bạn có thể gửi thêm link bằng tay. Gửi BO QUA để dùng danh sách tự phát hiện và tiếp tục.",
    "Nếu không gửi gì, bot sẽ tự tiếp tục sau 10 giây."
  );
  return lines.join("\n");
}

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
    const autoProductLinks = productLinkCatalogService.findProductLinksInText(`${session.title}\n\n${session.content}`);

    logger.info("auto_product_links_detected", {
      userId,
      postType,
      count: autoProductLinks.length,
      titles: autoProductLinks.map((product) => product.title).slice(0, 10)
    });

    setSession(userId, {
      state: "waiting_product_link",
      postType,
      title: session.title,
      content: session.content,
      imageBase64: processedImage.base64,
      imageMimeType: processedImage.mimeType,
      autoProductLinks
    });

    scheduleProductLinkAutoSkip(userId, PRODUCT_LINK_AUTO_SKIP_MS, () => submitDraftPostAfterProductLinkTimeout(ctx, userId));

    await replySafely(ctx, buildProductLinkPrompt(autoProductLinks), {
      userId,
      postType,
      autoProductLinks: autoProductLinks.length
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Không thể xử lý ảnh dưới 1MB";
    logger.error("photo handler failed", { userId, reason, postType: session.postType ?? "blog" });
    resetSession(userId);
    await replySafely(ctx, `❌ Tạo bài nháp thất bại: ${reason}`, { userId, postType: session.postType ?? "blog" });
  }
}
