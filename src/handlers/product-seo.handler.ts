import { randomUUID } from "node:crypto";
import { Context } from "telegraf";
import { canEditProducts } from "../bot/guards";
import { analyzeBookDNA, enrichBookDNA } from "../services/book-dna.service";
import { auditProductSeoMarketing, stripHtml } from "../services/product-audit.service";
import {
  formatExistingProductDescription,
  generateProductSeoMarketing,
  smartFormatSubmittedProductDescription
} from "../services/ai-product-seo.service";
import { extractNhanamProductAlias } from "../services/product-url.service";
import { sapoProductService } from "../services/sapo-product.service";
import {
  deleteDetectedProductUrlJob,
  clearProductSeoEnrichmentWait,
  clearProductSeoFormatDescriptionWait,
  clearProductSeoPreparationWait,
  deleteProductSeoBookUnderstandingJob,
  deleteProductSeoPendingJob,
  getDetectedProductUrlJob,
  getProductSeoBookUnderstandingJob,
  getProductSeoEnrichmentWait,
  getProductSeoFormatDescriptionWait,
  getProductSeoPreparationWait,
  getProductSeoPendingJob,
  saveDetectedProductUrlJob,
  saveProductSeoBookUnderstandingJob,
  setProductSeoFormatDescriptionWait,
  setProductSeoPreparationWait,
  setProductSeoEnrichmentWait,
  saveProductSeoPendingJob
} from "../services/product-seo-job-store.service";
import { BookDNA, ProductSeoBookUnderstandingJob, ProductSeoPendingJob, ProductSeoPreparationJob } from "../types/product-seo.types";
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

type BufferedEnrichmentInput = {
  ctx: TextContext;
  jobId: string;
  parts: string[];
  timer: ReturnType<typeof setTimeout>;
};

const MAX_PREVIEW_LENGTH = 3400;
const ENRICHMENT_INPUT_DEBOUNCE_MS = 4000;
const SEO_FIELDS_DISABLED_MESSAGE =
  "Flow đã đổi: bot chỉ cập nhật mô tả sản phẩm từ nội dung bạn tự nhập, không cập nhật SEO fields.";
const PRODUCT_EDIT_FORBIDDEN_MESSAGE =
  "Bạn không có quyền sửa sản phẩm Sapo. Chỉ Telegram ID 1623038607 được phép cập nhật sản phẩm; phần blog vẫn dùng bình thường.";

const enrichmentInputBuffers = new Map<number, BufferedEnrichmentInput>();
const preparationInputBuffers = new Map<number, BufferedEnrichmentInput>();
const formatDescriptionInputBuffers = new Map<number, BufferedEnrichmentInput>();

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

async function rejectProductEditIfNeeded(
  ctx: Context,
  userId: number,
  logContext: Record<string, unknown> = {}
): Promise<boolean> {
  if (canEditProducts(userId)) {
    return false;
  }

  logger.warn("product_edit_forbidden", { userId, ...logContext });
  await replySafely(ctx, PRODUCT_EDIT_FORBIDDEN_MESSAGE, { userId, ...logContext });
  return true;
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
    "Đã format mô tả mới:",
    "",
    `Tên: ${job.productTitle}`,
    `Alias: ${job.productAlias}`,
    `ID: ${job.productId}`,
    "",
    "Preview mô tả:",
    stripHtml(job.finalBodyHtml),
    "",
    "Bạn muốn cập nhật mô tả sản phẩm bằng bản này không?"
  ];

  if (job.audit.warnings.length > 0) {
    preview.push("", "Cảnh báo:", formatList(job.audit.warnings));
  }

  return truncatePreview(preview.join("\n"));
}

function buildActionButtons(jobId: string): InlineKeyboardButton[][] {
  return [
    [{ text: "Cập nhật mô tả", callback_data: `seo_desc:${jobId}` }],
    [{ text: "Hủy", callback_data: `seo_cancel:${jobId}` }]
  ];
}

function buildPreparationButtons(jobId: string): InlineKeyboardButton[][] {
  return [
    [{ text: "Viết lại hoàn toàn", callback_data: `seo_replace:${jobId}` }],
    [{ text: "Bổ sung", callback_data: `seo_supplement:${jobId}` }],
    [{ text: "Hủy", callback_data: `seo_cancel_detect:${jobId}` }]
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

  const foreignPraiseQuotes = job.bookDNA.foreignPraiseQuotes ?? [];
  if (foreignPraiseQuotes.length > 0) {
    lines.push("", "Praise báo nước ngoài đã dịch:", formatList(foreignPraiseQuotes));
  }

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

async function startProductSeoPreparation(ctx: Context, userId: number, alias: string): Promise<void> {
  const job = saveDetectedProductUrlJob({ userId, alias });
  logger.info("product_url_detected", { userId, jobId: job.jobId, alias });
  await replyWithButtonsSafely(
    ctx,
    [
      "Đã nhận URL sản phẩm Nhã Nam.",
      "",
      "Bạn muốn xử lý mô tả theo cách nào?",
      "",
      "Viết lại hoàn toàn: bạn nhập nội dung mới, bot format rồi hỏi cập nhật thay thế mô tả hiện tại.",
      "Bổ sung: bạn nhập phần cần thêm, bot nối với mô tả hiện tại trên Sapo rồi format lại HTML.",
      "",
      "Bot chỉ dùng AI để format HTML thông minh, không cập nhật Sapo trước khi bạn xác nhận."
    ].join("\n"),
    buildPreparationButtons(job.jobId),
    { userId, jobId: job.jobId, alias }
  );
}

async function analyzeProductByAlias(
  ctx: Context,
  userId: number,
  alias: string,
  humanEnrichmentText?: string
): Promise<void> {
  logger.info("product_alias_extracted", { userId, alias });
  await replySafely(
    ctx,
    humanEnrichmentText
      ? "Đang tìm sản phẩm và phân tích Book DNA từ dữ liệu đã gom..."
      : "Đang tìm sản phẩm và phân tích Book DNA...",
    { userId, alias }
  );

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
      sameAuthorProducts: [],
      humanEnrichmentText
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
    enrichments: humanEnrichmentText
      ? [
          {
            dataType: "pre-analysis material",
            summary: "Đã dùng tư liệu bổ sung trước khi phân tích Book DNA.",
            insights: [],
            createdAt: Date.now()
          }
        ]
      : [],
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

async function formatSubmittedProductDescriptionByAlias(
  ctx: Context,
  userId: number,
  alias: string,
  submittedDescriptionText: string,
  formatMode: "replace" | "append" = "replace"
): Promise<void> {
  logger.info("product_alias_extracted", { userId, alias, mode: "format_submitted_description", formatMode });
  await replySafely(
    ctx,
    formatMode === "append"
      ? "Đang lấy mô tả hiện tại, nối phần bổ sung và dùng AI format lại HTML."
      : "Đang dùng AI format mô tả bạn vừa gửi. Bot không tự viết thêm nội dung.",
    { userId, alias, formatMode }
  );

  const product = await sapoProductService.findProductByAlias(alias);
  if (!product || !product.id || !product.title) {
    logger.warn("sapo_product_not_found", { userId, alias, mode: "format_submitted_description" });
    await replySafely(ctx, "Không tìm thấy sản phẩm tương ứng trong Sapo.", { userId, alias });
    return;
  }
  logger.info("sapo_product_found", {
    userId,
    productId: product.id,
    alias,
    title: product.title,
    mode: "format_submitted_description"
  });

  const supplementInput = buildFormatDescriptionInput(product, submittedDescriptionText, formatMode);
  const formattedResult = await smartFormatSubmittedProductDescription(product, supplementInput.sourceText);
  if (supplementInput.warning) {
    formattedResult.warnings.push(supplementInput.warning);
  }
  logger.info("ai_product_description_formatted", {
    userId,
    productId: product.id,
    alias,
    mode: "format_submitted_description",
    formatMode
  });

  if (
    await rejectProductEditIfNeeded(ctx, userId, {
      productId: product.id,
      alias,
      mode: "format_submitted_description",
      formatMode
    })
  ) {
    return;
  }

  await sapoProductService.updateProductContent(product.id, formattedResult.finalBodyHtml, `<!-- seo-bot-auto-update:${randomUUID()} -->`, {
    userId,
    productId: product.id,
    alias,
    mode: "format_submitted_description",
    formatMode
  });

  logger.info("product_seo_update_description_success", {
    userId,
    productId: product.id,
    alias,
    mode: "format_submitted_description",
    formatMode
  });
  await replySafely(
    ctx,
    [
      formatMode === "append" ? "Đã bổ sung và cập nhật mô tả sản phẩm:" : "Đã cập nhật mô tả sản phẩm:",
      "",
      product.title,
      buildProductUrl(alias),
      ...(formattedResult.warnings.length > 0 ? ["", "Cảnh báo:", formatList(formattedResult.warnings)] : [])
    ].join("\n"),
    { userId, productId: product.id, alias, formatMode }
  );
}

function buildFormatDescriptionInput(
  product: { content?: string; summary?: string },
  submittedDescriptionText: string,
  formatMode: "replace" | "append"
): { sourceText: string; warning?: string } {
  const submittedText = submittedDescriptionText.trim();
  if (formatMode !== "append") {
    return { sourceText: submittedText };
  }

  const currentText = stripHtml(product.content || product.summary || "").trim();
  if (!currentText) {
    return {
      sourceText: submittedText,
      warning: "Không thấy mô tả hiện tại trên Sapo nên bot chỉ format phần bổ sung bạn gửi."
    };
  }

  return {
    sourceText: [currentText, submittedText].filter(Boolean).join("\n\n")
  };
}

function createFormatOnlyBookDNA(title: string): BookDNA {
  return {
    bookType: "Format mô tả người dùng nhập",
    genreOrCategory: "",
    readerDNA: "Không phân tích bằng AI trong chế độ format-only.",
    buyerDNA: "Không phân tích bằng AI trong chế độ format-only.",
    readingExperience: "Không phân tích bằng AI trong chế độ format-only.",
    corePromise: "Giữ nguyên text hiện có của người dùng.",
    competitiveAdvantage: "Chỉ chuẩn hóa cấu trúc HTML, không sửa câu chữ.",
    positioningStatement: `Format mô tả người dùng nhập cho ${title}.`,
    selectedFramework: "Format-only",
    corePremise: "",
    coreAppeal: "Giữ nguyên nội dung hiện có.",
    emotionalPromise: "",
    intellectualPromise: "",
    targetReaders: [],
    buyingReasons: [],
    sellingPoints: [],
    authorLeverage: "",
    seriesOrBrandLeverage: "",
    comparableTitlesOrSignals: [],
    foreignPraiseQuotes: [],
    toneOfVoice: "",
    marketingAngle: "Không viết mới.",
    seoKeywords: [],
    forbiddenClaims: [],
    missingData: [],
    confidence: 0
  };
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
    product: bookJob.product,
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
    await startProductSeoPreparation(ctx, userId, alias);
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

  if (await rejectProductEditIfNeeded(ctx, userId, { alias, command: "testupdate" })) {
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

  await startProductSeoPreparation(ctx, userId, alias);

  return true;
}

export async function handleProductSeoEnrichmentText(ctx: TextContext): Promise<boolean> {
  const userId = getUserId(ctx);
  const text = ctx.message.text?.trim();

  if (!userId || !text) {
    return false;
  }

  const formatDescriptionJob = getProductSeoFormatDescriptionWait(userId);
  if (formatDescriptionJob) {
    bufferProductSeoFormatDescriptionInput(ctx, userId, formatDescriptionJob, text);
    return true;
  }

  return false;
}

function bufferProductSeoFormatDescriptionInput(
  ctx: TextContext,
  userId: number,
  job: ProductSeoPreparationJob,
  text: string
): void {
  const existing = formatDescriptionInputBuffers.get(userId);
  if (existing) {
    clearTimeout(existing.timer);
  }

  const parts = existing && existing.jobId === job.jobId ? [...existing.parts, text] : [text];
  const timer = setTimeout(() => {
    void processBufferedProductSeoFormatDescription(userId);
  }, ENRICHMENT_INPUT_DEBOUNCE_MS);

  formatDescriptionInputBuffers.set(userId, {
    ctx,
    jobId: job.jobId,
    parts,
    timer
  });

  logger.info("product_seo_format_description_input_buffered", {
    userId,
    jobId: job.jobId,
    alias: job.alias,
    formatMode: job.formatMode ?? "replace",
    parts: parts.length
  });
}

async function processBufferedProductSeoFormatDescription(userId: number): Promise<void> {
  const buffered = formatDescriptionInputBuffers.get(userId);
  if (!buffered) {
    return;
  }

  formatDescriptionInputBuffers.delete(userId);
  const job = getProductSeoFormatDescriptionWait(userId);
  if (!job || job.jobId !== buffered.jobId) {
    return;
  }

  const combinedText = buffered.parts.join("\n\n").trim();
  if (!combinedText) {
    return;
  }

  clearProductSeoFormatDescriptionWait(userId);
  deleteDetectedProductUrlJob(job.jobId);

  try {
    await formatSubmittedProductDescriptionByAlias(buffered.ctx, userId, job.alias, combinedText, job.formatMode ?? "replace");
  } catch (error) {
    const reason = formatFriendlyError(error);
    logger.error("product_seo_update_failed", {
      userId,
      jobId: job.jobId,
      alias: job.alias,
      reason,
      mode: "format_submitted_description",
      formatMode: job.formatMode ?? "replace"
    });
    await replySafely(buffered.ctx, `Không format được mô tả mới: ${reason}`, { userId, jobId: job.jobId, alias: job.alias });
  }
}

function bufferProductSeoPreparationInput(
  ctx: TextContext,
  userId: number,
  job: ProductSeoPreparationJob,
  text: string
): void {
  const existing = preparationInputBuffers.get(userId);
  if (existing) {
    clearTimeout(existing.timer);
  }

  const parts = existing && existing.jobId === job.jobId ? [...existing.parts, text] : [text];
  const timer = setTimeout(() => {
    void processBufferedProductSeoPreparation(userId);
  }, ENRICHMENT_INPUT_DEBOUNCE_MS);

  preparationInputBuffers.set(userId, {
    ctx,
    jobId: job.jobId,
    parts,
    timer
  });

  logger.info("product_seo_preparation_input_buffered", {
    userId,
    jobId: job.jobId,
    alias: job.alias,
    parts: parts.length
  });
}

async function processBufferedProductSeoPreparation(userId: number): Promise<void> {
  const buffered = preparationInputBuffers.get(userId);
  if (!buffered) {
    return;
  }

  preparationInputBuffers.delete(userId);
  const job = getProductSeoPreparationWait(userId);
  if (!job || job.jobId !== buffered.jobId) {
    return;
  }

  const combinedText = buffered.parts.join("\n\n").trim();
  if (!combinedText) {
    return;
  }

  clearProductSeoPreparationWait(userId);
  deleteDetectedProductUrlJob(job.jobId);

  try {
    await analyzeProductByAlias(buffered.ctx, userId, job.alias, combinedText);
  } catch (error) {
    const reason = formatFriendlyError(error);
    logger.error("product_seo_update_failed", { userId, jobId: job.jobId, alias: job.alias, reason });
    await replySafely(buffered.ctx, `Không tối ưu được sản phẩm: ${reason}`, { userId, jobId: job.jobId, alias: job.alias });
  }
}

function bufferProductSeoEnrichmentInput(
  ctx: TextContext,
  userId: number,
  job: ProductSeoBookUnderstandingJob,
  text: string
): void {
  const existing = enrichmentInputBuffers.get(userId);
  if (existing) {
    clearTimeout(existing.timer);
  }

  const parts = existing && existing.jobId === job.jobId ? [...existing.parts, text] : [text];
  const timer = setTimeout(() => {
    void processBufferedProductSeoEnrichment(userId);
  }, ENRICHMENT_INPUT_DEBOUNCE_MS);

  enrichmentInputBuffers.set(userId, {
    ctx,
    jobId: job.jobId,
    parts,
    timer
  });

  logger.info("product_seo_enrichment_input_buffered", {
    userId,
    jobId: job.jobId,
    productId: job.productId,
    alias: job.productAlias,
    parts: parts.length
  });
}

async function processBufferedProductSeoEnrichment(userId: number): Promise<void> {
  const buffered = enrichmentInputBuffers.get(userId);
  if (!buffered) {
    return;
  }

  enrichmentInputBuffers.delete(userId);
  const job = getProductSeoEnrichmentWait(userId);
  if (!job || job.jobId !== buffered.jobId) {
    return;
  }

  const combinedText = buffered.parts.join("\n\n").trim();
  if (!combinedText) {
    return;
  }

  try {
    logger.info("book_dna_started", {
      userId,
      jobId: job.jobId,
      productId: job.productId,
      alias: job.productAlias,
      enrichmentParts: buffered.parts.length
    });
    const enrichment = await enrichBookDNA({
      product: job.product,
      currentBookDNA: job.bookDNA,
      enrichmentText: combinedText
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

    await replyWithButtonsSafely(buffered.ctx, buildBookDnaMessage(updatedJob), buildEnrichedBookDnaButtons(updatedJob.jobId), {
      userId,
      jobId: updatedJob.jobId,
      productId: updatedJob.productId,
      alias: updatedJob.productAlias
    });
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
    await replySafely(buffered.ctx, `Không cập nhật được Book DNA từ dữ liệu bổ sung: ${reason}`, {
      userId,
      jobId: job.jobId,
      productId: job.productId,
      alias: job.productAlias
    });
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

  if (action === "seo_replace" || action === "seo_supplement" || action === "seo_auto_write") {
    const detectedJob = getDetectedProductUrlJob(jobId, userId);
    if (!detectedJob) {
      await replySafely(ctx, "Job xác nhận đã hết hạn hoặc không thuộc user này.", { userId, jobId });
      return;
    }

    const formatMode = action === "seo_supplement" ? "append" : "replace";
    setProductSeoFormatDescriptionWait(userId, jobId, formatMode);
    await replySafely(
      ctx,
      [
        formatMode === "append"
          ? "Bạn gửi phần nội dung muốn bổ sung cho sản phẩm này nhé."
          : "Bạn gửi mô tả mới cho sản phẩm này nhé.",
        "",
        formatMode === "append"
          ? "Bot sẽ nối phần này với mô tả hiện tại trên Sapo rồi dùng AI format lại HTML."
          : "Bot sẽ dùng AI format HTML thông minh và thay thế mô tả hiện tại sau khi bạn xác nhận.",
        "",
        "Có thể gửi nhiều tin nhắn liên tiếp; bot sẽ nối lại rồi phản hồi một lần.",
        "",
        "Quy tắc format: tên sách in đậm, tên tác giả in nghiêng, praise tách thành lời khen in nghiêng và nguồn praise căn phải in đậm."
      ].join("\n"),
      { userId, jobId, alias: detectedJob.alias, formatMode }
    );
    return;
  }

  if (
    [
      "seo_start",
      "seo_analyze",
      "seo_pre_enrich",
      "seo_enrich",
      "seo_write",
      "seo_rewrite",
      "seo_meta",
      "seo_all"
    ].includes(action)
  ) {
    await replySafely(
      ctx,
      "Flow đã đổi: bot chỉ format nội dung bạn tự nhập rồi hỏi cập nhật mô tả. Vui lòng gửi lại link sách để bắt đầu flow mới.",
      { userId, jobId, action }
    );
    return;
  }

  if (action === "seo_start" || action === "seo_analyze") {
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

  if (action === "seo_pre_enrich") {
    const preparationJob = getDetectedProductUrlJob(jobId, userId);
    if (!preparationJob) {
      await replySafely(ctx, "Job xác nhận đã hết hạn hoặc không thuộc user này.", { userId, jobId });
      return;
    }

    setProductSeoPreparationWait(userId, jobId);
    await replySafely(
      ctx,
      [
        "Bạn gửi tư liệu bổ sung cho cuốn sách này nhé.",
        "",
        "Có thể gửi nhiều tin nhắn liên tiếp; bot sẽ nối lại rồi phân tích Book DNA một lần.",
        "",
        "Nhận text, link website, link bài báo, link Wikipedia/Nhã Nam, back cover, review, thư giới thiệu sách, ghi chú BTV hoặc praise báo nước ngoài."
      ].join("\n"),
      { userId, jobId, alias: preparationJob.alias }
    );
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

    if (action === "seo_rewrite") {
      if (!job.product) {
        await replySafely(ctx, "Job cũ thiếu dữ liệu sản phẩm để viết lại. Vui lòng chạy /seo lại.", { userId, jobId });
        return;
      }

      await replySafely(ctx, "Đang viết lại bản nháp mô tả sản phẩm...", {
        userId,
        jobId,
        productId: job.productId,
        alias: job.productAlias
      });

      const audit = auditProductSeoMarketing(job.product, job.bookDNA);
      const aiResult = await generateProductSeoMarketing({
        product: job.product,
        audit,
        bookDNA: job.bookDNA
      });

      const rewrittenJob: ProductSeoPendingJob = {
        ...job,
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
          warnings: aiResult.warnings
        },
        createdAt: Date.now()
      };

      saveProductSeoPendingJob(rewrittenJob);
      logger.info("ai_product_seo_generated", {
        userId,
        jobId,
        productId: job.productId,
        alias: job.productAlias,
        rewritten: true,
        improvedSeoScore: aiResult.improvedSeoScore,
        improvedMarketingScore: aiResult.improvedMarketingScore
      });
      await replyWithButtonsSafely(ctx, buildPreviewMessage(rewrittenJob), buildActionButtons(rewrittenJob.jobId), {
        userId,
        jobId,
        productId: job.productId,
        alias: job.productAlias
      });
      return;
    }

    if (action === "seo_desc") {
      if (
        await rejectProductEditIfNeeded(ctx, userId, {
          jobId,
          productId: job.productId,
          alias: job.productAlias,
          action
        })
      ) {
        return;
      }

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
      if (
        await rejectProductEditIfNeeded(ctx, userId, {
          jobId,
          productId: job.productId,
          alias: job.productAlias,
          action
        })
      ) {
        return;
      }

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
