import { Context } from "telegraf";
import { config } from "../config/env";
import { messages } from "../bot/messages";
import { getSession, resetSession, setSession } from "../bot/sessionStore";
import { plainTextToHtml } from "../services/content.service";
import { sapoService } from "../services/sapo.service";
import { shopApiService } from "../services/shopapi.service";
import { LinkedProduct } from "../types/sapo";
import { PostType } from "../types/session";
import { logger } from "../utils/logger";
import { replySafely } from "../utils/telegram";

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
  useAiFormat?: boolean;
};

function isSkipProductLinkInput(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  return normalized === "bo qua" || normalized === "bỏ qua" || normalized === "skip";
}

function isSkipKeywordsInput(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  const compact = normalized.replace(/[.!?…]+/g, "").replace(/\s+/g, " ").trim();

  return (
    normalized === "." ||
    ["k", "ko", "khong", "không"].includes(compact) ||
    compact.startsWith("khong co") ||
    compact.startsWith("không có")
  );
}

function parseKeywordTags(text: string): string[] {
  return text
    .split(",")
    .map((keyword) => keyword.trim())
    .filter(Boolean);
}

function mergeTags(existingTag: string | undefined, keywords: string[]): string | undefined {
  const merged = [
    ...(existingTag ? [existingTag] : []),
    ...keywords
  ].filter(Boolean);

  return merged.length > 0 ? merged.join(", ") : undefined;
}

function isYesInput(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  return ["co", "có", "yes", "y", "ok", "okay"].includes(normalized);
}

function isNoInput(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  return ["khong", "không", "ko", "k", "no", "n"].includes(normalized);
}

async function generateAutomaticTags(input: DraftSubmissionInput): Promise<string | undefined> {
  try {
    const keywords = await shopApiService.generateKeywordTags({
      title: input.title,
      content: input.content
    });

    return mergeTags(input.tags, keywords);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Không tạo được từ khóa tự động";
    logger.warn("automatic keyword generation skipped", { reason, postType: input.postType });
    return input.tags;
  }
}

export async function submitDraftPost(
  ctx: Context,
  userId: number,
  input: DraftSubmissionInput
): Promise<void> {
  await replySafely(ctx, messages.submitting, { userId, postType: input.postType });

  const isAuthorPost = input.postType === "author";
  const blogName = isAuthorPost ? config.sapoAuthorBlogName : config.sapoDefaultBlogName;

  try {
    let aiFormatNote: string | undefined;
    let contentHtml: string;

    if (input.useAiFormat) {
      try {
        contentHtml = await shopApiService.formatContentHtml({
          title: input.title,
          content: input.content
        });
      } catch (error) {
        const reason = error instanceof Error ? error.message : "AI format không đạt kiểm tra";
        logger.warn("AI formatting skipped, falling back to plain HTML", {
          userId,
          postType: input.postType,
          reason
        });
        aiFormatNote = "AI format không đạt kiểm tra giữ nguyên nội dung, đã dùng format thường.";
        await replySafely(ctx, `⚠️ ${aiFormatNote}`, { userId, postType: input.postType });
        contentHtml = plainTextToHtml(input.content, {
          embedDirectImageLinks: !isAuthorPost,
          linkedProducts: isAuthorPost ? [] : input.linkedProducts ?? []
        });
      }
    } else {
      contentHtml = plainTextToHtml(input.content, {
        embedDirectImageLinks: !isAuthorPost,
        linkedProducts: isAuthorPost ? [] : input.linkedProducts ?? []
      });
    }

    const tags = await generateAutomaticTags(input);

    const result = await sapoService.createDraftArticle({
      title: input.title,
      content: contentHtml,
      imageBase64: input.imageBase64,
      imageMimeType: input.imageMimeType,
      tags,
      blogName,
      templateLayout: isAuthorPost ? config.sapoAuthorTemplateLayout : undefined,
      prependFeatureImageInContent: !isAuthorPost
    });

    logger.info("create draft success", {
      userId,
      articleId: result.id,
      title: result.title,
      postType: input.postType,
      tags: tags ?? "",
      linkedProducts: input.linkedProducts?.length ?? 0
    });
    resetSession(userId);

    const lines = [
      "✅ Đã tạo bài nháp thành công",
      `- Tiêu đề: ${result.title}`,
      `- Blog: ${blogName}`,
      `- Article ID: ${result.id}`
    ];

    if (tags) {
      lines.push(`- Tag: ${tags}`);
    }

    if (aiFormatNote) {
      lines.push(`- Ghi chú: ${aiFormatNote}`);
    }

    await replySafely(ctx, lines.join("\n"), { userId, postType: input.postType, articleId: result.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Lỗi hệ thống, vui lòng thử lại";
    logger.error("create draft fail", { userId, reason: message, postType: input.postType });
    resetSession(userId);
    await replySafely(ctx, `❌ Tạo bài nháp thất bại: ${message}`, { userId, postType: input.postType });
  }
}

export async function handleTextMessage(ctx: TextContext): Promise<void> {
  const userId = ctx.from?.id;
  const text = ctx.message.text?.trim();

  if (!userId || !text) {
    await replySafely(ctx, messages.genericStartFlow);
    return;
  }

  const session = getSession(userId);

  try {
    if (session.state === "idle") {
      await replySafely(ctx, messages.genericStartFlow, { userId });
      return;
    }

    if (session.state === "waiting_title") {
      setSession(userId, {
        state: "waiting_content",
        postType: session.postType ?? "blog",
        title: text
      });
      await replySafely(ctx, messages.askContent, { userId });
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
      await replySafely(ctx, messages.contentAppended, { userId });
      return;
    }

    if (session.state === "waiting_image") {
      await replySafely(ctx, messages.waitImagePhoto, { userId });
      return;
    }

    if (session.state === "waiting_product_link") {
      if (!session.title || !session.content || !session.imageBase64 || !session.imageMimeType) {
        resetSession(userId);
        await replySafely(ctx, "❌ Tạo bài nháp thất bại: Lỗi hệ thống, vui lòng thử lại", { userId });
        return;
      }

      if (isSkipProductLinkInput(text)) {
        setSession(userId, {
          state: "waiting_ai_format_choice",
          postType: "blog",
          title: session.title,
          content: session.content,
          imageBase64: session.imageBase64,
          imageMimeType: session.imageMimeType
        });
        await replySafely(ctx, messages.askAiFormat, { userId });
        return;
      }

      try {
        const resolvedProducts = await sapoService.resolveProductLinks(text);
        setSession(userId, {
          state: "waiting_ai_format_choice",
          postType: "blog",
          title: session.title,
          content: session.content,
          imageBase64: session.imageBase64,
          imageMimeType: session.imageMimeType,
          tags: resolvedProducts.tag,
          productTag: resolvedProducts.tag,
          linkedProducts: resolvedProducts.linkedProducts
        });
        await replySafely(ctx, messages.askAiFormat, { userId });
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Skip invalid product links";
        logger.warn("product link resolution failed", { userId, reason: message });
        setSession(userId, {
          state: "waiting_ai_format_choice",
          postType: "blog",
          title: session.title,
          content: session.content,
          imageBase64: session.imageBase64,
          imageMimeType: session.imageMimeType
        });
        await replySafely(ctx, messages.askAiFormat, { userId });
        return;
      }
    }

    if (session.state === "waiting_keywords") {
      if (!session.title || !session.content || !session.imageBase64 || !session.imageMimeType) {
        resetSession(userId);
        await replySafely(ctx, "❌ Tạo bài nháp thất bại: Lỗi hệ thống, vui lòng thử lại", { userId });
        return;
      }

      if (isSkipKeywordsInput(text)) {
        setSession(userId, {
          state: "waiting_ai_format_choice",
          postType: "blog",
          title: session.title,
          content: session.content,
          imageBase64: session.imageBase64,
          imageMimeType: session.imageMimeType,
          tags: session.productTag,
          productTag: session.productTag,
          linkedProducts: session.linkedProducts
        });
        await replySafely(ctx, messages.askAiFormat, { userId });
        return;
      }

      const keywordTags = parseKeywordTags(text);
      const tags = mergeTags(session.productTag, keywordTags);
      setSession(userId, {
        state: "waiting_ai_format_choice",
        postType: "blog",
        title: session.title,
        content: session.content,
        imageBase64: session.imageBase64,
        imageMimeType: session.imageMimeType,
        tags,
        productTag: session.productTag,
        linkedProducts: session.linkedProducts
      });
      await replySafely(ctx, messages.askAiFormat, { userId });
      return;
    }

    if (session.state === "waiting_ai_format_choice") {
      if (!session.title || !session.content || !session.imageBase64 || !session.imageMimeType || !session.postType) {
        resetSession(userId);
        await replySafely(ctx, "❌ Tạo bài nháp thất bại: Lỗi hệ thống, vui lòng thử lại", { userId });
        return;
      }

      if (!isYesInput(text) && !isNoInput(text)) {
        await replySafely(ctx, messages.waitAiFormatChoiceText, { userId });
        return;
      }

      const useAiFormat = isYesInput(text);
      if (useAiFormat) {
        await replySafely(ctx, messages.formattingWithAi, { userId, postType: session.postType });
      }

      await submitDraftPost(ctx, userId, {
        title: session.title,
        content: session.content,
        imageBase64: session.imageBase64,
        imageMimeType: session.imageMimeType,
        postType: session.postType,
        tags: session.tags ?? session.productTag,
        linkedProducts: session.linkedProducts,
        useAiFormat
      });
      return;
    }

    await replySafely(ctx, messages.genericStartFlow, { userId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Lỗi hệ thống, vui lòng thử lại";
    logger.error("text handler failed", { userId, reason: message });
    await replySafely(ctx, `❌ Tạo bài nháp thất bại: ${message}`, { userId });
  }
}
