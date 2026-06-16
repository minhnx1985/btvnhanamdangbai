import { randomUUID } from "node:crypto";
import { Context } from "telegraf";
import { auditProductSeoMarketing } from "../services/product-audit.service";
import { generateProductSeoMarketing } from "../services/ai-product-seo.service";
import { productResearchService } from "../services/product-research.service";
import { extractNhanamProductAlias } from "../services/product-url.service";
import { sapoProductService } from "../services/sapo-product.service";
import {
  deleteDetectedProductUrlJob,
  deleteProductSeoPendingJob,
  getDetectedProductUrlJob,
  getProductSeoPendingJob,
  saveDetectedProductUrlJob,
  saveProductSeoPendingJob
} from "../services/product-seo-job-store.service";
import { ProductSeoPendingJob } from "../types/product-seo.types";
import { logger } from "../utils/logger";
import { replySafely } from "../utils/telegram";

type TextContext = Context & {
  message: {
    text?: string;
  };
};

type InlineKeyboardButton = {
  text: string;
  callback_data: string;
};

const MAX_PREVIEW_LENGTH = 3400;

function getUserId(ctx: Context): number | undefined {
  return ctx.from?.id;
}

function getMessageText(ctx: Context): string {
  if (!("message" in ctx) || !ctx.message || !("text" in ctx.message)) {
    return "";
  }

  return typeof ctx.message.text === "string" ? ctx.message.text : "";
}

function getCallbackData(ctx: Context): string | undefined {
  const callbackQuery = ctx.callbackQuery;
  if (!callbackQuery || !("data" in callbackQuery)) {
    return undefined;
  }

  return callbackQuery.data;
}

async function replyWithButtonsSafely(
  ctx: Context,
  text: string,
  inlineKeyboard: InlineKeyboardButton[][],
  logContext: Record<string, unknown> = {}
): Promise<void> {
  try {
    await ctx.reply(text, {
      reply_markup: {
        inline_keyboard: inlineKeyboard
      }
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Unknown Telegram reply error";
    logger.error("Telegram inline reply failed", { ...logContext, reason });
  }
}

async function answerCallbackSafely(ctx: Context): Promise<void> {
  try {
    await ctx.answerCbQuery();
  } catch {
    return;
  }
}

function truncatePreview(text: string): { text: string; truncated: boolean } {
  if (text.length <= MAX_PREVIEW_LENGTH) {
    return { text, truncated: false };
  }

  return {
    text: `${text.slice(0, MAX_PREVIEW_LENGTH - 80).trim()}\n\nPreview đã được rút gọn do giới hạn Telegram.`,
    truncated: true
  };
}

function buildProductUrl(alias: string): string {
  return `https://nhanam.vn/${alias}`;
}

function formatList(items: string[]): string {
  if (items.length === 0) {
    return "- Chưa phát hiện vấn đề nổi bật.";
  }

  return items.map((item) => `- ${item}`).join("\n");
}

function buildPreviewMessage(job: ProductSeoPendingJob): string {
  const preview = [
    "Đã phân tích sản phẩm:",
    "",
    `Tên: ${job.productTitle}`,
    `Alias: ${job.productAlias}`,
    `ID: ${job.productId}`,
    "",
    `SEO hiện tại: ${job.audit.currentSeoScore}/100`,
    `Marketing hiện tại: ${job.audit.currentMarketingScore}/100`,
    "",
    "Vấn đề phát hiện:",
    formatList(job.audit.issues),
    "",
    "Cơ hội tối ưu:",
    formatList(job.audit.opportunities),
    "",
    "Đề xuất mới:",
    "",
    "Meta title:",
    job.seoTitle,
    "",
    "Meta description:",
    job.metaDescription,
    "",
    "Preview mô tả:",
    job.finalBodyHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
    "",
    `SEO sau tối ưu dự kiến: ${job.audit.improvedSeoScore}/100`,
    `Marketing sau tối ưu dự kiến: ${job.audit.improvedMarketingScore}/100`
  ];

  if (job.audit.warnings.length > 0) {
    preview.push("", "Cảnh báo:", formatList(job.audit.warnings));
  }

  if (job.audit.researchSources.length > 0) {
    preview.push(
      "",
      "Nguồn tham khảo đã dùng:",
      job.audit.researchSources
        .slice(0, 3)
        .map((source) => `- ${source.title}${source.url ? ` (${source.url})` : ""}`)
        .join("\n")
    );
  }

  return truncatePreview(preview.join("\n")).text;
}

function buildActionButtons(jobId: string): InlineKeyboardButton[][] {
  return [
    [{ text: "Cập nhật mô tả", callback_data: `seo_desc:${jobId}` }],
    [{ text: "Cập nhật SEO", callback_data: `seo_meta:${jobId}` }],
    [{ text: "Cập nhật tất cả", callback_data: `seo_all:${jobId}` }],
    [{ text: "Hủy", callback_data: `seo_cancel:${jobId}` }]
  ];
}

async function analyzeProductByAlias(ctx: Context, userId: number, alias: string): Promise<void> {
  logger.info("product_alias_extracted", { userId, alias });
  await replySafely(ctx, "Đang phân tích sản phẩm và tạo đề xuất SEO...", { userId, alias });

  const product = await sapoProductService.findProductByAlias(alias);
  if (!product || !product.id || !product.title) {
    logger.warn("sapo_product_not_found", { userId, alias });
    await replySafely(ctx, "Không tìm thấy sản phẩm tương ứng trong Sapo.", { userId, alias });
    return;
  }
  logger.info("sapo_product_found", { userId, productId: product.id, alias });

  const audit = auditProductSeoMarketing(product);
  logger.info("product_audit_completed", {
    userId,
    productId: product.id,
    alias,
    seoScore: audit.currentSeoScore,
    marketingScore: audit.currentMarketingScore
  });

  const researchSources = await productResearchService.researchProduct(product);
  logger.info("product_external_research_completed", {
    userId,
    productId: product.id,
    alias,
    sourceCount: researchSources.length
  });

  const aiResult = await generateProductSeoMarketing({ product, audit, researchSources });
  logger.info("ai_product_seo_generated", {
    userId,
    productId: product.id,
    alias,
    improvedSeoScore: aiResult.improvedSeoScore,
    improvedMarketingScore: aiResult.improvedMarketingScore
  });

  const job: ProductSeoPendingJob = {
    type: "product_seo_marketing_update",
    jobId: randomUUID(),
    userId,
    productId: product.id,
    productAlias: alias,
    productTitle: product.title,
    seoTitle: aiResult.seoTitle,
    metaDescription: aiResult.metaDescription,
    finalBodyHtml: aiResult.finalBodyHtml,
    audit: {
      currentSeoScore: audit.currentSeoScore,
      currentMarketingScore: audit.currentMarketingScore,
      improvedSeoScore: aiResult.improvedSeoScore,
      improvedMarketingScore: aiResult.improvedMarketingScore,
      issues: audit.issues,
      opportunities: audit.opportunities,
      warnings: aiResult.warnings,
      researchSources
    },
    createdAt: Date.now()
  };

  saveProductSeoPendingJob(job);
  logger.info("product_seo_pending_created", { userId, jobId: job.jobId, productId: product.id, alias });
  await replyWithButtonsSafely(ctx, buildPreviewMessage(job), buildActionButtons(job.jobId), {
    userId,
    jobId: job.jobId,
    productId: product.id,
    alias
  });
}

export async function handleSeoCommand(ctx: Context): Promise<void> {
  const userId = getUserId(ctx);
  const text = getMessageText(ctx);
  const alias = extractNhanamProductAlias(text);

  if (!userId) {
    await replySafely(ctx, "Không xác định được user Telegram.");
    return;
  }

  if (!alias) {
    await replySafely(ctx, "URL không hợp lệ. Vui lòng dùng: /seo https://nhanam.vn/<alias>", { userId });
    return;
  }

  try {
    await analyzeProductByAlias(ctx, userId, alias);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Lỗi hệ thống";
    logger.error("product_seo_update_failed", { userId, alias, reason });
    await replySafely(ctx, `Không tối ưu được sản phẩm: ${reason}`, { userId, alias });
  }
}

export async function handleDetectedProductUrl(ctx: TextContext): Promise<boolean> {
  const userId = getUserId(ctx);
  const text = ctx.message.text ?? "";
  const alias = extractNhanamProductAlias(text);

  if (!userId || !alias) {
    return false;
  }

  const job = saveDetectedProductUrlJob({ userId, alias });
  logger.info("product_url_detected", { userId, jobId: job.jobId, alias });
  await replyWithButtonsSafely(
    ctx,
    "Phát hiện URL sản phẩm Nhã Nam. Bạn muốn tối ưu SEO & marketing cho sản phẩm này không?",
    [
      [{ text: "Tối ưu SEO & marketing", callback_data: `seo_start:${job.jobId}` }],
      [{ text: "Hủy", callback_data: `seo_cancel_detect:${job.jobId}` }]
    ],
    { userId, jobId: job.jobId, alias }
  );

  return true;
}

export async function handleProductSeoCallback(ctx: Context): Promise<void> {
  const userId = getUserId(ctx);
  const data = getCallbackData(ctx);

  await answerCallbackSafely(ctx);

  if (!userId || !data) {
    return;
  }

  const [action, jobId] = data.split(":");
  if (!action || !jobId || !action.startsWith("seo_")) {
    return;
  }

  if (action === "seo_start") {
    const detectedJob = getDetectedProductUrlJob(jobId, userId);
    if (!detectedJob) {
      await replySafely(ctx, "Job xác nhận đã hết hạn hoặc không thuộc user này.", { userId, jobId });
      return;
    }

    deleteDetectedProductUrlJob(jobId);
    try {
      await analyzeProductByAlias(ctx, userId, detectedJob.alias);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Lỗi hệ thống";
      logger.error("product_seo_update_failed", { userId, jobId, alias: detectedJob.alias, reason });
      await replySafely(ctx, `Không tối ưu được sản phẩm: ${reason}`, { userId, jobId });
    }
    return;
  }

  if (action === "seo_cancel_detect") {
    deleteDetectedProductUrlJob(jobId);
    logger.info("product_seo_cancelled", { userId, jobId });
    await replySafely(ctx, "Đã hủy. Chưa có thay đổi nào trên Sapo.", { userId, jobId });
    return;
  }

  const job = getProductSeoPendingJob(jobId, userId);
  if (!job) {
    await replySafely(ctx, "Job xác nhận đã hết hạn hoặc không thuộc user này.", { userId, jobId });
    return;
  }

  try {
    if (action === "seo_cancel") {
      deleteProductSeoPendingJob(jobId);
      logger.info("product_seo_cancelled", { userId, jobId, productId: job.productId, alias: job.productAlias });
      await replySafely(ctx, "Đã hủy. Chưa có thay đổi nào trên Sapo.", { userId, jobId });
      return;
    }

    if (action === "seo_desc") {
      await sapoProductService.updateProductDescription(job.productId, job.finalBodyHtml);
      deleteProductSeoPendingJob(jobId);
      logger.info("product_seo_update_description_success", {
        userId,
        jobId,
        productId: job.productId,
        alias: job.productAlias
      });
      await replySafely(ctx, `Đã cập nhật mô tả sản phẩm:\n${job.productTitle}\n${buildProductUrl(job.productAlias)}`, {
        userId,
        jobId
      });
      return;
    }

    if (action === "seo_meta") {
      const result = await sapoProductService.updateProductSeoFields(job.productId, {
        seoTitle: job.seoTitle,
        metaDescription: job.metaDescription
      });
      if (result.updated) {
        deleteProductSeoPendingJob(jobId);
        logger.info("product_seo_update_meta_success", { userId, jobId, productId: job.productId, alias: job.productAlias });
        await replySafely(ctx, `Đã cập nhật SEO sản phẩm:\n${job.productTitle}\n${buildProductUrl(job.productAlias)}`, {
          userId,
          jobId
        });
        return;
      }

      await replySafely(ctx, result.reason ?? "Chưa xác định chắc field SEO trong Sapo API. Hiện chưa cập nhật SEO fields.", {
        userId,
        jobId
      });
      return;
    }

    if (action === "seo_all") {
      const result = await sapoProductService.updateProductDescriptionAndSeo(job.productId, {
        html: job.finalBodyHtml,
        seoTitle: job.seoTitle,
        metaDescription: job.metaDescription
      });
      deleteProductSeoPendingJob(jobId);
      logger.info("product_seo_update_all_success", {
        userId,
        jobId,
        productId: job.productId,
        alias: job.productAlias,
        seoUpdated: result.seoUpdated
      });
      const message = result.seoUpdated
        ? `Đã cập nhật mô tả và SEO sản phẩm:\n${job.productTitle}\n${buildProductUrl(job.productAlias)}`
        : `Đã cập nhật mô tả. SEO fields chưa được cập nhật vì chưa xác định chắc field trong Sapo API.\n${job.productTitle}\n${buildProductUrl(job.productAlias)}`;
      await replySafely(ctx, message, { userId, jobId });
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Update Sapo thất bại";
    logger.error("product_seo_update_failed", { userId, jobId, productId: job.productId, alias: job.productAlias, reason });
    await replySafely(ctx, `Update Sapo thất bại: ${reason}`, { userId, jobId });
  }
}
