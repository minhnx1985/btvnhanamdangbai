import { Context } from "telegraf";
import { messages } from "../bot/messages";
import { getSession, resetSession, setSession } from "../bot/sessionStore";
import { plainTextToHtml } from "../services/content.service";
import { sapoService } from "../services/sapo.service";
import { logger } from "../utils/logger";

type TextContext = Context & {
  message: {
    text?: string;
  };
};

type DraftSubmissionInput = {
  title: string;
  content: string;
  imageBase64: string;
  imageMimeType: string;
  tags?: string;
};

function isSkipProductLinkInput(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  return normalized === "bo qua" || normalized === "bỏ qua" || normalized === "skip";
}

export async function submitDraftPost(
  ctx: Context,
  userId: number,
  input: DraftSubmissionInput
): Promise<void> {
  await ctx.reply(messages.submitting);

  try {
    const result = await sapoService.createDraftArticle({
      title: input.title,
      content: plainTextToHtml(input.content),
      imageBase64: input.imageBase64,
      imageMimeType: input.imageMimeType,
      tags: input.tags
    });

    logger.info("create draft success", {
      userId,
      articleId: result.id,
      title: result.title,
      tags: input.tags ?? ""
    });
    resetSession(userId);

    const lines = [
      "✅ Đã tạo bài nháp thành công",
      `- Tiêu đề: ${result.title}`,
      "- Blog: Biên tập viên giới thiệu",
      `- Article ID: ${result.id}`
    ];

    if (input.tags) {
      lines.push(`- Tag: ${input.tags}`);
    }

    await ctx.reply(lines.join("\n"));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Lỗi hệ thống, vui lòng thử lại";
    logger.error("create draft fail", { userId, reason: message });
    resetSession(userId);
    await ctx.reply(`❌ Tạo bài nháp thất bại: ${message}`);
  }
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
      const nextContent = session.content ? `${session.content}\n\n${text}` : text;

      setSession(userId, {
        state: "waiting_content",
        title: session.title,
        content: nextContent
      });
      await ctx.reply(messages.contentAppended);
      return;
    }

    if (session.state === "waiting_image") {
      await ctx.reply(messages.waitImagePhoto);
      return;
    }

    if (session.state === "waiting_product_link") {
      if (!session.title || !session.content || !session.imageBase64 || !session.imageMimeType) {
        resetSession(userId);
        await ctx.reply("❌ Tạo bài nháp thất bại: Lỗi hệ thống, vui lòng thử lại");
        return;
      }

      if (isSkipProductLinkInput(text)) {
        await submitDraftPost(ctx, userId, {
          title: session.title,
          content: session.content,
          imageBase64: session.imageBase64,
          imageMimeType: session.imageMimeType
        });
        return;
      }

      try {
        const productTag = await sapoService.resolveProductTagFromUrl(text);
        await submitDraftPost(ctx, userId, {
          title: session.title,
          content: session.content,
          imageBase64: session.imageBase64,
          imageMimeType: session.imageMimeType,
          tags: productTag
        });
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : messages.productLookupFailed;
        logger.warn("product link resolution failed", { userId, reason: message });
        await submitDraftPost(ctx, userId, {
          title: session.title,
          content: session.content,
          imageBase64: session.imageBase64,
          imageMimeType: session.imageMimeType
        });
        return;
      }
    }

    await ctx.reply(messages.genericStartFlow);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Lỗi hệ thống, vui lòng thử lại";
    logger.error("text handler failed", { userId, reason: message });
    await ctx.reply(`❌ Tạo bài nháp thất bại: ${message}`);
  }
}
