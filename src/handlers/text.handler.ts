import { Context } from "telegraf";
import { PRODUCT_EDITOR_TELEGRAM_USER_ID } from "../bot/guards";
import { config } from "../config/env";
import { messages } from "../bot/messages";
import { getSession, resetSession, setSession } from "../bot/sessionStore";
import { formatArticleContentHtml } from "../services/content.service";
import { detectDraftIntake } from "../services/draft-intake.service";
import { sapoService } from "../services/sapo.service";
import { shopApiService } from "../services/shopapi.service";
import { LinkedProduct } from "../types/sapo";
import { PostType } from "../types/session";
import { logger } from "../utils/logger";
import { replySafely } from "../utils/telegram";
import { handleDetectedProductUrl, handleProductSeoEnrichmentText } from "./product-seo.handler";

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

function getSapoBlogName(postType: PostType): string {
  if (postType === "author") {
    return config.sapoAuthorBlogName;
  }

  if (postType === "site_blog") {
    return config.sapoBlogBlogName;
  }

  return config.sapoDefaultBlogName;
}

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
  const shouldPublishImmediately = userId === PRODUCT_EDITOR_TELEGRAM_USER_ID;
  await replySafely(
    ctx,
    shouldPublishImmediately ? "Đang format và đăng bài..." : "Đang format và tạo bài nháp...",
    { userId, postType: input.postType, publish: shouldPublishImmediately }
  );

  const isAuthorPost = input.postType === "author";
  const blogName = getSapoBlogName(input.postType);

  try {
    const contentHtml = await formatArticleContentHtml({
      title: input.title,
      content: input.content,
      postType: input.postType,
      embedDirectImageLinks: !isAuthorPost,
      linkedProducts: isAuthorPost ? [] : input.linkedProducts ?? []
    });
    const tags = await generateAutomaticTags(input);

    const result = await sapoService.createDraftArticle({
      title: input.title,
      content: contentHtml,
      imageBase64: input.imageBase64,
      imageMimeType: input.imageMimeType,
      tags,
      blogName,
      templateLayout: isAuthorPost ? config.sapoAuthorTemplateLayout : undefined,
      prependFeatureImageInContent: !isAuthorPost,
      publish: shouldPublishImmediately
    });

    logger.info(shouldPublishImmediately ? "publish article success" : "create draft success", {
      userId,
      articleId: result.id,
      title: result.title,
      postType: input.postType,
      tags: tags ?? "",
      linkedProducts: input.linkedProducts?.length ?? 0,
      url: result.url ?? ""
    });
    resetSession(userId);

    const lines = [
      shouldPublishImmediately ? "✅ Đã đăng bài thành công" : "✅ Đã tạo bài nháp thành công",
      `- Tiêu đề: ${result.title}`,
      `- Blog: ${blogName}`,
      `- Article ID: ${result.id}`
    ];

    if (tags) {
      lines.push(`- Tag: ${tags}`);
    }

    if (shouldPublishImmediately) {
      lines.push(result.url ? `- Link: ${result.url}` : "- Link: Sapo chưa trả handle/url để dựng link công khai.");
    }

    await replySafely(ctx, lines.join("\n"), { userId, postType: input.postType, articleId: result.id, url: result.url ?? "" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Lỗi hệ thống, vui lòng thử lại";
    logger.error(shouldPublishImmediately ? "publish article fail" : "create draft fail", {
      userId,
      reason: message,
      postType: input.postType
    });
    resetSession(userId);
    await replySafely(
      ctx,
      shouldPublishImmediately ? `❌ Đăng bài thất bại: ${message}` : `❌ Tạo bài nháp thất bại: ${message}`,
      { userId, postType: input.postType }
    );
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
    if (text.startsWith("/")) {
      return;
    }

    if (await handleProductSeoEnrichmentText(ctx)) {
      return;
    }

    if (session.state === "idle") {
      if (await handleDetectedProductUrl(ctx)) {
        return;
      }

      await replySafely(ctx, messages.genericStartFlow, { userId });
      return;
    }

    if (session.state === "waiting_title") {
      const intake = await detectDraftIntake(text);

      if (intake.kind === "title") {
        setSession(userId, {
          state: "waiting_content",
          postType: session.postType ?? "blog",
          title: intake.title
        });
        await replySafely(ctx, messages.askContent, { userId });
        return;
      }

      setSession(userId, {
        state: "waiting_content",
        postType: session.postType ?? "blog",
        title: intake.title,
        content: intake.content
      });
      await replySafely(
        ctx,
        [
          `Đã nhận bài và tự nhận diện tiêu đề: ${intake.title}`,
          "",
          "Bạn có thể gửi thêm nội dung hoặc gửi ảnh feature để sang bước tiếp theo."
        ].join("\n"),
        { userId, draftTitleDetection: intake.source }
      );
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
        const postType = session.postType ?? "blog";
        await submitDraftPost(ctx, userId, {
          title: session.title,
          content: session.content,
          imageBase64: session.imageBase64,
          imageMimeType: session.imageMimeType,
          postType
        });
        return;
      }

      try {
        const resolvedProducts = await sapoService.resolveProductLinks(text);
        const postType = session.postType ?? "blog";
        await submitDraftPost(ctx, userId, {
          title: session.title,
          content: session.content,
          imageBase64: session.imageBase64,
          imageMimeType: session.imageMimeType,
          tags: resolvedProducts.tag,
          linkedProducts: resolvedProducts.linkedProducts,
          postType
        });
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Skip invalid product links";
        logger.warn("product link resolution failed", { userId, reason: message });
        const postType = session.postType ?? "blog";
        await submitDraftPost(ctx, userId, {
          title: session.title,
          content: session.content,
          imageBase64: session.imageBase64,
          imageMimeType: session.imageMimeType,
          postType
        });
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
        const postType = session.postType ?? "blog";
        await submitDraftPost(ctx, userId, {
          title: session.title,
          content: session.content,
          imageBase64: session.imageBase64,
          imageMimeType: session.imageMimeType,
          tags: session.productTag,
          linkedProducts: session.linkedProducts,
          postType
        });
        return;
      }

      const keywordTags = parseKeywordTags(text);
      const postType = session.postType ?? "blog";
      await submitDraftPost(ctx, userId, {
        title: session.title,
        content: session.content,
        imageBase64: session.imageBase64,
        imageMimeType: session.imageMimeType,
        tags: mergeTags(session.productTag, keywordTags),
        linkedProducts: session.linkedProducts,
        postType
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
