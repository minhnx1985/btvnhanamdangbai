import { Context } from "telegraf";
import { messages } from "../bot/messages";
import { getSession, resetSession, setSession } from "../bot/sessionStore";
import { plainTextToHtml, prependFeatureImageToHtml } from "../services/content.service";
import { sapoService } from "../services/sapo.service";
import { normalizeDecision, truncateText } from "../utils/text";
import { logger } from "../utils/logger";

type TextContext = Context & {
  message: {
    text?: string;
  };
};

function buildPreview(title: string, content: string, blogName: string): string {
  return [
    "Xem lại bài viết:",
    "",
    `Tiêu đề: ${title}`,
    "",
    "Nội dung:",
    truncateText(content, 500),
    "",
    `Blog: ${blogName}`,
    "Trạng thái: Nháp",
    "",
    "Trả lời Y để đăng, N để hủy."
  ].join("\n");
}

export async function handleTextMessage(ctx: TextContext): Promise<void> {
  const userId = ctx.from?.id;
  const text = ctx.message.text?.trim();

  if (!userId || !text) {
    await ctx.reply(messages.genericStartFlow);
    return;
  }

  const session = getSession(userId);

  try {
    if (session.state === "idle") {
      await ctx.reply(messages.genericStartFlow);
      return;
    }

    if (session.state === "waiting_title") {
      setSession(userId, {
        state: "waiting_content",
        title: text
      });
      await ctx.reply(messages.askContent);
      return;
    }

    if (session.state === "waiting_content") {
      setSession(userId, {
        state: "waiting_image",
        title: session.title,
        content: text
      });
      await ctx.reply(messages.askImage);
      return;
    }

    if (session.state === "waiting_image") {
      await ctx.reply(messages.waitImagePhoto);
      return;
    }

    if (session.state === "waiting_confirmation") {
      const decision = normalizeDecision(text);

      if (decision === "no") {
        resetSession(userId);
        await ctx.reply(messages.cancelPosting);
        return;
      }

      if (decision === "unknown") {
        await ctx.reply(messages.waitConfirmationText);
        return;
      }

      if (!session.title || !session.content || !session.imageBase64 || !session.imageMimeType) {
        resetSession(userId);
        await ctx.reply("❌ Tạo bài nháp thất bại: Lỗi hệ thống, vui lòng thử lại");
        return;
      }

      await ctx.reply(messages.submitting);

      try {
        const articleContentHtml = prependFeatureImageToHtml(
          plainTextToHtml(session.content),
          session.imageBase64,
          session.imageMimeType
        );

        const result = await sapoService.createDraftArticle({
          title: session.title,
          content: articleContentHtml,
          imageBase64: session.imageBase64,
          imageMimeType: session.imageMimeType
        });

        logger.info("create draft success", { userId, articleId: result.id, title: result.title });
        resetSession(userId);
        await ctx.reply(
          [
            "✅ Đã tạo bài nháp thành công",
            `- Tiêu đề: ${result.title}`,
            "- Blog: Biên tập viên giới thiệu",
            `- Article ID: ${result.id}`
          ].join("\n")
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : "Lỗi hệ thống, vui lòng thử lại";
        logger.error("create draft fail", { userId, reason: message });
        resetSession(userId);
        await ctx.reply(`❌ Tạo bài nháp thất bại: ${message}`);
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Lỗi hệ thống, vui lòng thử lại";
    logger.error("text handler failed", { userId, reason: message });
    await ctx.reply(`❌ Tạo bài nháp thất bại: ${message}`);
  }
}

export function buildConfirmationPreview(title: string, content: string, blogName: string): string {
  return buildPreview(title, content, blogName);
}
