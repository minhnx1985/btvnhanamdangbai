import { Context } from "telegraf";
import { config } from "../config/env";
import { messages } from "../bot/messages";
import { getSession, resetSession, setSession } from "../bot/sessionStore";
import { plainTextToHtml } from "../services/content.service";
import { sapoService } from "../services/sapo.service";
import { LinkedProduct } from "../types/sapo";
import { PostType } from "../types/session";
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
  postType: PostType;
  tags?: string;
  linkedProducts?: LinkedProduct[];
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

  const isAuthorPost = input.postType === "author";
  const blogName = isAuthorPost ? config.sapoAuthorBlogName : config.sapoDefaultBlogName;

  try {
    const contentHtml = plainTextToHtml(input.content, {
      embedDirectImageLinks: !isAuthorPost,
      linkedProducts: isAuthorPost ? [] : input.linkedProducts ?? []
    });

    const result = await sapoService.createDraftArticle({
      title: input.title,
      content: contentHtml,
      imageBase64: input.imageBase64,
      imageMimeType: input.imageMimeType,
      tags: input.tags,
      blogName,
      templateLayout: isAuthorPost ? config.sapoAuthorTemplateLayout : undefined,
      prependFeatureImageInContent: !isAuthorPost
    });

    logger.info("create draft success", {
      userId,
      articleId: result.id,
      title: result.title,
      postType: input.postType,
      tags: input.tags ?? "",
      linkedProducts: input.linkedProducts?.length ?? 0
    });
    resetSession(userId);

    const lines = [
      "✅ Đã tạo bài nháp thành công",
      `- Tiêu đề: ${result.title}`,
      `- Blog: ${blogName}`,
      `- Article ID: ${result.id}`
    ];

    if (input.tags) {
      lines.push(`- Tag: ${input.tags}`);
    }

    await ctx.reply(lines.join("\n"));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Lỗi hệ thống, vui lòng thử lại";
    logger.error("create draft fail", { userId, reason: message, postType: input.postType });
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
        postType: session.postType ?? "blog",
        title: text
      });
      await ctx.reply(messages.askContent);
      return;
    }

    if (session.state === "waiting_content") {
      const nextContent = session.content ? `${session.content}\n\n${text}` : text;

      setSession(userId, {
        state: "waiting_content",
        postType: session.postType ?? "blog",
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
          imageMimeType: session.imageMimeType,
          postType: "blog"
        });
        return;
      }

      try {
        const resolvedProducts = await sapoService.resolveProductLinks(text);
        await submitDraftPost(ctx, userId, {
          title: session.title,
          content: session.content,
          imageBase64: session.imageBase64,
          imageMimeType: session.imageMimeType,
          postType: "blog",
          tags: resolvedProducts.tag,
          linkedProducts: resolvedProducts.linkedProducts
        });
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Skip invalid product links";
        logger.warn("product link resolution failed", { userId, reason: message });
        await submitDraftPost(ctx, userId, {
          title: session.title,
          content: session.content,
          imageBase64: session.imageBase64,
          imageMimeType: session.imageMimeType,
          postType: "blog"
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
