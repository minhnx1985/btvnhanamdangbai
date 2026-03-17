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
};

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
      imageMimeType: input.imageMimeType
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

    await ctx.reply(messages.genericStartFlow);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Lỗi hệ thống, vui lòng thử lại";
    logger.error("text handler failed", { userId, reason: message });
    await ctx.reply(`❌ Tạo bài nháp thất bại: ${message}`);
  }
}
