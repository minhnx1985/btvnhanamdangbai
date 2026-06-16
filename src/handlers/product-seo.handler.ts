import { randomUUID } from "node:crypto";
import { Context } from "telegraf";
import { analyzeBookDNA, enrichBookDNA } from "../services/book-dna.service";
import { auditProductSeoMarketing, stripHtml } from "../services/product-audit.service";
import { generateProductSeoMarketing } from "../services/ai-product-seo.service";
import { extractNhanamProductAlias } from "../services/product-url.service";
import { sapoProductService } from "../services/sapo-product.service";
import {
  deleteDetectedProductUrlJob,
  clearProductSeoEnrichmentWait,
  deleteProductSeoBookUnderstandingJob,
  deleteProductSeoPendingJob,
  getDetectedProductUrlJob,
  getProductSeoBookUnderstandingJob,
  getProductSeoEnrichmentWait,
  getProductSeoPendingJob,
  saveDetectedProductUrlJob,
  saveProductSeoBookUnderstandingJob,
  setProductSeoEnrichmentWait,
  saveProductSeoPendingJob
} from "../services/product-seo-job-store.service";
import { ProductSeoBookUnderstandingJob, ProductSeoPendingJob } from "../types/product-seo.types";
import { AppError } from "../utils/errors";
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
const SEO_FIELDS_DISABLED_MESSAGE =
  "Hiện chưa xác định chắc field SEO trong Sapo Product API. Bot chưa cập nhật SEO fields.";

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

function truncatePreview(text: string): string {
  if (text.length <= MAX_PREVIEW_LENGTH) {
    return text;
  }

  return `${text.slice(0, MAX_PREVIEW_LENGTH - 80).trim()}\n\nPreview đã được rút gọn do giới hạn Telegram.`;
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
    "BOOK DNA",
    `Loại sách: ${job.bookDNA.bookType || "Chưa rõ"}`,
    `Sức hút chính: ${job.bookDNA.coreAppeal || "Chưa rõ"}`,
    `Angle marketing: ${job.bookDNA.marketingAngle || "Chưa rõ"}`,
    "Độc giả mục tiêu:",
    formatList(job.bookDNA.targetReaders),
    "Lý do mua:",
    formatList(job.bookDNA.buyingReasons),
    `Confidence: ${job.bookDNA.confidence}/100`,
    "",
    ...(job.bookDNA.confidence < 40
      ? [
          "Cảnh báo: dữ liệu sản phẩm hiện quá ít để viết mô tả marketing tốt. Nên bổ sung mô tả gốc, back cover, thông tin tác giả hoặc nội dung sách trước khi cập nhật.",
          ""
        ]
      : []),
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
    stripHtml(job.finalBodyHtml),
    "",
    `SEO sau tối ưu dự kiến: ${job.audit.improvedSeoScore}/100`,
    `Marketing sau tối ưu dự kiến: ${job.audit.improvedMarketingScore}/100`
  ];

  if (job.audit.warnings.length > 0) {
    preview.push("", "Cảnh báo:", formatList(job.audit.warnings));
  }

  preview.push("", "Bạn muốn cập nhật phần nào?");
  return truncatePreview(preview.join("\n"));
}

function buildActionButtons(jobId: string): InlineKeyboardButton[][] {
  return [
    [{ text: "Cập nhật mô tả", callback_data: `seo_desc:${jobId}` }],
    [{ text: "Cập nhật SEO", callback_data: `seo_meta:${jobId}` }],
    [{ text: "Cập nhật tất cả", callback_data: `seo_all:${jobId}` }],
    [{ text: "Hủy", callback_data: `seo_cancel:${jobId}` }]
  ];
}

function buildBookDnaButtons(jobId: string): InlineKeyboardButton[][] {
  return [
    [{ text: "Viết ngay", callback_data: `seo_write:${jobId}` }],
    [{ text: "Bổ sung dữ liệu", callback_data: `seo_enrich:${jobId}` }],
    [{ text: "Hủy", callback_data: `seo_cancel_book:${jobId}` }]
  ];
}

function buildEnrichedBookDnaButtons(jobId: string): InlineKeyboardButton[][] {
  return [
    [{ text: "Viết nội dung", callback_data: `seo_write:${jobId}` }],
    [{ text: "Bổ sung thêm dữ liệu", callback_data: `seo_enrich:${jobId}` }],
    [{ text: "Hủy", callback_data: `seo_cancel_book:${jobId}` }]
  ];
}

function buildBookDnaMessage(job: ProductSeoBookUnderstandingJob): string {
  const latestEnrichment = job.enrichments[job.enrichments.length - 1];
  const lines = [
    "BOOK DNA",
    "",
    `Tên: ${job.productTitle}`,
    `Alias: ${job.productAlias}`,
    `ID: ${job.productId}`,
    "",
    `Positioning: ${job.bookDNA.positioningStatement || "Chưa rõ"}`,
    `Reader DNA: ${job.bookDNA.readerDNA || "Chưa rõ"}`,
    `Buyer DNA: ${job.bookDNA.buyerDNA || "Chưa rõ"}`,
    `Reading Experience: ${job.bookDNA.readingExperience || "Chưa rõ"}`,
    `Core Promise: ${job.bookDNA.corePromise || "Chưa rõ"}`,
    `Competitive Advantage: ${job.bookDNA.competitiveAdvantage || "Chưa rõ"}`,
    `Framework: ${job.bookDNA.selectedFramework || "Chưa rõ"}`,
    `Confidence: ${job.bookDNA.confidence}/100`
  ];

  if (latestEnrichment) {
    lines.push(
      "",
      "Dữ liệu vừa bổ sung:",
      `Loại dữ liệu: ${latestEnrichment.dataType}`,
      `Tóm tắt: ${latestEnrichment.summary}`,
      "Insight hữu ích:",
      formatList(latestEnrichment.insights)
    );
  }

  if (job.bookDNA.confidence < 40) {
    lines.push(
      "",
      "Cảnh báo: dữ liệu sản phẩm hiện quá ít hoặc Positioning Statement còn yếu. Nên bổ sung mô tả gốc, back cover, thông tin tác giả, review hoặc ghi chú BTV trước khi viết."
    );
  }

  lines.push("", "Bạn có muốn bổ sung thêm dữ liệu trước khi viết không?");
  return truncatePreview(lines.join("\n"));
}

async function analyzeProductByAlias(ctx: Context, userId: number, alias: string): Promise<void> {
  logger.info("product_alias_extracted", { userId, alias });
  await replySafely(ctx, "Đang tìm sản phẩm và phân tích Book DNA...", { userId, alias });

  const product = await sapoProductService.findProductByAlias(alias);
  if (!product || !product.id || !product.title) {
    logger.warn("sapo_product_not_found", { userId, alias });
    await replySafely(ctx, "Không tìm thấy sản phẩm tương ứng trong Sapo.", { userId, alias });
    return;
  }
  logger.info("sapo_product_found", { userId, productId: product.id, alias, title: product.title });

  logger.info("book_dna_started", { userId, productId: product.id, alias });
  const bookDNA = await analyzeBookDNA({
    product,
    relatedData: {
      currentContentText: stripHtml(product.content || ""),
      summaryText: stripHtml(product.summary || ""),
      tags: product.tags,
      categories: [],
      sameAuthorProducts: []
    }
  });
  logger.info("book_dna_completed", { userId, productId: product.id, alias, confidence: bookDNA.confidence });

  const audit = auditProductSeoMarketing(product, bookDNA);
  logger.info("product_audit_completed", {
    userId,
    productId: product.id,
    alias,
    seoScore: audit.currentSeoScore,
    marketingScore: audit.currentMarketingScore
  });

  const job: ProductSeoBookUnderstandingJob = {
    type: "product_seo_book_understanding",
    jobId: randomUUID(),
    userId,
    product,
    productId: product.id,
    productAlias: alias,
    productTitle: product.title,
    bookDNA,
    audit,
    enrichments: [],
    createdAt: Date.now()
  };

  saveProductSeoBookUnderstandingJob(job);
  logger.info("product_seo_pending_created", { userId, jobId: job.jobId, productId: product.id, alias });
  await replyWithButtonsSafely(ctx, buildBookDnaMessage(job), buildBookDnaButtons(job.jobId), {
    userId,
    jobId: job.jobId,
    productId: product.id,
    alias
  });
}

async function generateWritingPreviewFromBookJob(
  ctx: Context,
  userId: number,
  bookJob: ProductSeoBookUnderstandingJob
): Promise<void> {
  const audit = auditProductSeoMarketing(bookJob.product, bookJob.bookDNA);
  logger.info("product_audit_completed", {
    userId,
    jobId: bookJob.jobId,
    productId: bookJob.productId,
    alias: bookJob.productAlias,
    seoScore: audit.currentSeoScore,
    marketingScore: audit.currentMarketingScore
  });

  await replySafely(ctx, "Đã có Final Book Understanding. Đang viết preview mô tả sản phẩm...", {
    userId,
    jobId: bookJob.jobId,
    productId: bookJob.productId,
    alias: bookJob.productAlias
  });

  const aiResult = await generateProductSeoMarketing({
    product: bookJob.product,
    audit,
    bookDNA: bookJob.bookDNA
  });
  logger.info("ai_product_seo_generated", {
    userId,
    jobId: bookJob.jobId,
    productId: bookJob.productId,
    alias: bookJob.productAlias,
    improvedSeoScore: aiResult.improvedSeoScore,
    improvedMarketingScore: aiResult.improvedMarketingScore
  });

  const updateJob: ProductSeoPendingJob = {
    type: "product_seo_marketing_update",
    jobId: bookJob.jobId,
    userId,
    productId: bookJob.productId,
    productAlias: bookJob.productAlias,
    productTitle: bookJob.productTitle,
    seoTitle: aiResult.seoTitle,
    metaDescription: aiResult.metaDescription,
    finalBodyHtml: aiResult.finalBodyHtml,
    bookDNA: bookJob.bookDNA,
    audit: {
      currentSeoScore: audit.currentSeoScore,
      currentMarketingScore: audit.currentMarketingScore,
      improvedSeoScore: aiResult.improvedSeoScore,
      improvedMarketingScore: aiResult.improvedMarketingScore,
      issues: audit.issues,
      opportunities: audit.opportunities,
      warnings: aiResult.warnings
    },
    createdAt: Date.now()
  };

  saveProductSeoPendingJob(updateJob);
  deleteProductSeoBookUnderstandingJob(bookJob.jobId);
  clearProductSeoEnrichmentWait(userId);
  logger.info("product_seo_pending_created", {
    userId,
    jobId: updateJob.jobId,
    productId: updateJob.productId,
    alias: updateJob.productAlias
  });
  await replyWithButtonsSafely(ctx, buildPreviewMessage(updateJob), buildActionButtons(updateJob.jobId), {
    userId,
    jobId: updateJob.jobId,
    productId: updateJob.productId,
    alias: updateJob.productAlias
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
    const reason = formatFriendlyError(error);
    logger.error("product_seo_update_failed", { userId, alias, reason });
    await replySafely(ctx, `Không tối ưu được sản phẩm: ${reason}`, { userId, alias });
  }
}

export async function handleInspectProductCommand(ctx: Context): Promise<void> {
  const userId = getUserId(ctx);
  const alias = extractNhanamProductAlias(getMessageText(ctx));

  if (!userId) {
    await replySafely(ctx, "Không xác định được user Telegram.");
    return;
  }

  if (!alias) {
    await replySafely(ctx, "URL không hợp lệ. Vui lòng dùng: /inspectproduct https://nhanam.vn/<alias>", { userId });
    return;
  }

  try {
    const inspect = await sapoProductService.inspectProductByAlias(alias);
    if (!inspect) {
      await replySafely(ctx, "Không tìm thấy sản phẩm tương ứng trong Sapo.", { userId, alias });
      return;
    }

    await replySafely(
      ctx,
      [
        "Product inspect",
        "",
        `ID: ${inspect.product.id}`,
        `Title: ${inspect.product.title}`,
        `Alias: ${inspect.product.alias ?? inspect.product.handle ?? ""}`,
        `content length: ${inspect.contentLength}`,
        `summary length: ${inspect.summaryLength}`,
        `updated_at: ${inspect.product.updatedAt ?? ""}`,
        "",
        "Possible SEO fields:",
        ...inspect.possibleSeoFields.map((item) => `- ${item.field}: ${item.exists ? "exists" : "not found"}`)
      ].join("\n"),
      { userId, productId: inspect.product.id, alias }
    );
  } catch (error) {
    const reason = formatFriendlyError(error);
    logger.error("product_seo_update_failed", { userId, alias, reason });
    await replySafely(ctx, `Không inspect được sản phẩm: ${reason}`, { userId, alias });
  }
}

export async function handleTestUpdateCommand(ctx: Context): Promise<void> {
  const userId = getUserId(ctx);
  const alias = extractNhanamProductAlias(getMessageText(ctx));

  if (!userId) {
    await replySafely(ctx, "Không xác định được user Telegram.");
    return;
  }

  if (!alias) {
    await replySafely(ctx, "URL không hợp lệ. Vui lòng dùng: /testupdate https://nhanam.vn/<alias>", { userId });
    return;
  }

  try {
    const product = await sapoProductService.findProductByAlias(alias);
    if (!product || !product.id) {
      await replySafely(ctx, "Không tìm thấy sản phẩm tương ứng trong Sapo.", { userId, alias });
      return;
    }

    const result = await sapoProductService.testUpdateProductContent(product.id);
    await replySafely(
      ctx,
      [
        "Test update product.content",
        "",
        "PUT OK",
        "GET verify OK",
        "product.content changed",
        "",
        `ID: ${product.id}`,
        `Title: ${product.title}`,
        `Alias: ${product.alias ?? product.handle ?? alias}`,
        `Marker: ${result.marker}`
      ].join("\n"),
      { userId, productId: product.id, alias }
    );
  } catch (error) {
    const reason = formatFriendlyError(error);
    logger.error("product_seo_update_failed", { userId, alias, reason });
    await replySafely(ctx, `Test update thất bại: ${reason}`, { userId, alias });
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

export async function handleProductSeoEnrichmentText(ctx: TextContext): Promise<boolean> {
  const userId = getUserId(ctx);
  const text = ctx.message.text?.trim();

  if (!userId || !text) {
    return false;
  }

  const job = getProductSeoEnrichmentWait(userId);
  if (!job) {
    return false;
  }

  try {
    await replySafely(ctx, "Đang đọc dữ liệu bổ sung và cập nhật lại Book DNA...", {
      userId,
      jobId: job.jobId,
      productId: job.productId,
      alias: job.productAlias
    });

    logger.info("book_dna_started", {
      userId,
      jobId: job.jobId,
      productId: job.productId,
      alias: job.productAlias
    });
    const enrichment = await enrichBookDNA({
      product: job.product,
      currentBookDNA: job.bookDNA,
      enrichmentText: text
    });

    const updatedJob: ProductSeoBookUnderstandingJob = {
      ...job,
      bookDNA: enrichment.updatedBookDNA,
      audit: auditProductSeoMarketing(job.product, enrichment.updatedBookDNA),
      createdAt: Date.now(),
      enrichments: [
        ...job.enrichments,
        {
          dataType: enrichment.dataType,
          summary: enrichment.summary,
          insights: enrichment.insights,
          createdAt: Date.now()
        }
      ]
    };

    saveProductSeoBookUnderstandingJob(updatedJob);
    clearProductSeoEnrichmentWait(userId);
    logger.info("book_dna_completed", {
      userId,
      jobId: updatedJob.jobId,
      productId: updatedJob.productId,
      alias: updatedJob.productAlias,
      confidence: updatedJob.bookDNA.confidence
    });
    logger.info("product_audit_completed", {
      userId,
      jobId: updatedJob.jobId,
      productId: updatedJob.productId,
      alias: updatedJob.productAlias,
      seoScore: updatedJob.audit.currentSeoScore,
      marketingScore: updatedJob.audit.currentMarketingScore
    });

    await replyWithButtonsSafely(ctx, buildBookDnaMessage(updatedJob), buildEnrichedBookDnaButtons(updatedJob.jobId), {
      userId,
      jobId: updatedJob.jobId,
      productId: updatedJob.productId,
      alias: updatedJob.productAlias
    });
    return true;
  } catch (error) {
    clearProductSeoEnrichmentWait(userId);
    const reason = formatFriendlyError(error);
    logger.error("product_seo_update_failed", {
      userId,
      jobId: job.jobId,
      productId: job.productId,
      alias: job.productAlias,
      reason
    });
    await replySafely(ctx, `Không cập nhật được Book DNA từ dữ liệu bổ sung: ${reason}`, {
      userId,
      jobId: job.jobId,
      productId: job.productId,
      alias: job.productAlias
    });
    return true;
  }
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
      const reason = formatFriendlyError(error);
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

  if (action === "seo_cancel_book") {
    const bookJob = getProductSeoBookUnderstandingJob(jobId, userId);
    if (!bookJob) {
      await replySafely(ctx, "Job xác nhận đã hết hạn hoặc không thuộc user này.", { userId, jobId });
      return;
    }

    deleteProductSeoBookUnderstandingJob(jobId);
    logger.info("product_seo_cancelled", { userId, jobId, productId: bookJob.productId, alias: bookJob.productAlias });
    await replySafely(ctx, "Đã hủy. Chưa có thay đổi nào trên Sapo.", { userId, jobId });
    return;
  }

  if (action === "seo_enrich") {
    const bookJob = getProductSeoBookUnderstandingJob(jobId, userId);
    if (!bookJob) {
      await replySafely(ctx, "Job xác nhận đã hết hạn hoặc không thuộc user này.", { userId, jobId });
      return;
    }

    setProductSeoEnrichmentWait(userId, jobId);
    await replySafely(
      ctx,
      [
        "Bạn gửi thêm dữ liệu cho cuốn sách này nhé.",
        "",
        "Có thể gửi text, link website, link bài báo, link Wikipedia/Nhã Nam, back cover, review, thư giới thiệu sách hoặc ghi chú BTV.",
        "",
        "Bot sẽ đọc dữ liệu mới, tóm tắt insight, cập nhật lại Book DNA rồi mới hỏi có viết nội dung không."
      ].join("\n"),
      { userId, jobId, productId: bookJob.productId, alias: bookJob.productAlias }
    );
    return;
  }

  if (action === "seo_write") {
    const bookJob = getProductSeoBookUnderstandingJob(jobId, userId);
    if (!bookJob) {
      await replySafely(ctx, "Job xác nhận đã hết hạn hoặc không thuộc user này.", { userId, jobId });
      return;
    }

    try {
      await generateWritingPreviewFromBookJob(ctx, userId, bookJob);
    } catch (error) {
      const reason = formatFriendlyError(error);
      logger.error("product_seo_update_failed", {
        userId,
        jobId,
        productId: bookJob.productId,
        alias: bookJob.productAlias,
        reason
      });
      await replySafely(ctx, `Không viết được nội dung sản phẩm: ${reason}`, {
        userId,
        jobId,
        productId: bookJob.productId,
        alias: bookJob.productAlias
      });
    }
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
      await sapoProductService.updateProductContent(job.productId, job.finalBodyHtml, `<!-- seo-bot-update:${job.jobId} -->`, {
        userId,
        jobId,
        alias: job.productAlias
      });
      deleteProductSeoPendingJob(jobId);
      logger.info("product_seo_update_description_success", {
        userId,
        jobId,
        productId: job.productId,
        alias: job.productAlias
      });
      await replySafely(
        ctx,
        `Đã cập nhật và xác nhận product.content đã thay đổi:\n\n${job.productTitle}\n${buildProductUrl(job.productAlias)}`,
        { userId, jobId, productId: job.productId, alias: job.productAlias }
      );
      return;
    }

    if (action === "seo_meta") {
      await replySafely(ctx, SEO_FIELDS_DISABLED_MESSAGE, { userId, jobId, productId: job.productId, alias: job.productAlias });
      return;
    }

    if (action === "seo_all") {
      await sapoProductService.updateProductContent(job.productId, job.finalBodyHtml, `<!-- seo-bot-update:${job.jobId} -->`, {
        userId,
        jobId,
        alias: job.productAlias
      });
      deleteProductSeoPendingJob(jobId);
      logger.info("product_seo_update_description_success", {
        userId,
        jobId,
        productId: job.productId,
        alias: job.productAlias
      });
      await replySafely(
        ctx,
        `Đã cập nhật mô tả sản phẩm. SEO fields chưa được cập nhật vì chưa xác định chắc field SEO trong Sapo Product API.\n\n${job.productTitle}\n${buildProductUrl(job.productAlias)}`,
        { userId, jobId, productId: job.productId, alias: job.productAlias }
      );
    }
  } catch (error) {
    const reason = formatFriendlyError(error);
    logger.error("product_seo_update_failed", {
      userId,
      jobId,
      productId: job.productId,
      alias: job.productAlias,
      reason
    });
    await replySafely(ctx, `Update Sapo thất bại: ${reason}`, {
      userId,
      jobId,
      productId: job.productId,
      alias: job.productAlias
    });
  }
}

function formatFriendlyError(error: unknown): string {
  if (error instanceof AppError && error.code === "SAPO_PRODUCT_CONTENT_VERIFY_FAILED") {
    return "Sapo trả OK nhưng product.content chưa đổi. Chưa xác nhận cập nhật thành công.";
  }

  if (error instanceof AppError) {
    return error.message;
  }

  return error instanceof Error ? error.message : "Lỗi hệ thống";
}
