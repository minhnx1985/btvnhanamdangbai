import { randomUUID } from "node:crypto";
import { Context } from "telegraf";
import { canEditProducts } from "../bot/guards";
import { generateMarketingComboProductTitle } from "../services/ai-combo-title.service";
import { generateMarketingSubtitle } from "../services/ai-product-subtitle.service";
import { extractNhanamProductAlias } from "../services/product-url.service";
import { isComboProductTitle, normalizeProductTitleForBook } from "../services/product-title-normalizer.service";
import { NormalizedSapoProduct } from "../types/product-seo.types";
import { sapoProductService } from "../services/sapo-product.service";
import { AppError } from "../utils/errors";
import { logger } from "../utils/logger";
import { replySafely } from "../utils/telegram";

type ProductTitleUpdateJob = {
  jobId: string;
  userId: number;
  productId: string | number;
  alias: string;
  oldTitle: string;
  newTitle: string;
  createdAt: number;
};

type InlineKeyboardButton = {
  text: string;
  callback_data: string;
};

const PRODUCT_TITLE_JOB_TTL_MS = 30 * 60 * 1000;
const productTitleUpdateJobs = new Map<string, ProductTitleUpdateJob>();
const PRODUCT_EDIT_FORBIDDEN_MESSAGE =
  "Bạn không có quyền sửa sản phẩm Sapo. Chỉ Telegram ID 1623038607 được phép cập nhật sản phẩm; phần blog vẫn dùng bình thường.";

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

function pruneExpiredJobs(): void {
  const now = Date.now();
  for (const [jobId, job] of productTitleUpdateJobs.entries()) {
    if (now - job.createdAt > PRODUCT_TITLE_JOB_TTL_MS) {
      productTitleUpdateJobs.delete(jobId);
    }
  }
}

function saveProductTitleUpdateJob(job: ProductTitleUpdateJob): void {
  pruneExpiredJobs();
  productTitleUpdateJobs.set(job.jobId, job);
}

function getProductTitleUpdateJob(jobId: string, userId: number): ProductTitleUpdateJob | null {
  pruneExpiredJobs();
  const job = productTitleUpdateJobs.get(jobId);
  if (!job || job.userId !== userId) {
    return null;
  }

  return job;
}

function deleteProductTitleUpdateJob(jobId: string): void {
  productTitleUpdateJobs.delete(jobId);
}

async function answerCallbackSafely(ctx: Context): Promise<void> {
  try {
    await ctx.answerCbQuery();
  } catch {
    return;
  }
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

function buildProductUrl(alias: string): string {
  return `https://nhanam.vn/${alias}`;
}

function readPrimaryTitle(title: string): string {
  return title.split(/\r?\n/)[0]?.trim() || title.trim();
}

type ProductTitleParts = {
  mainSourceTitle: string;
  existingSubtitle: string | null;
};

const SUBTITLE_WORDS = new Set([
  "a",
  "an",
  "anh",
  "ban",
  "bi",
  "bo",
  "cam",
  "cau",
  "cho",
  "chuyen",
  "con",
  "cuoc",
  "cua",
  "doi",
  "dich",
  "du",
  "duy",
  "guide",
  "hanh",
  "het",
  "hieu",
  "hoc",
  "journey",
  "lam",
  "lich",
  "memoir",
  "mot",
  "nghe",
  "ngon",
  "novel",
  "nguoi",
  "nha",
  "nhung",
  "song",
  "story",
  "su",
  "tam",
  "the",
  "thuat",
  "tien",
  "tinh",
  "tri",
  "trong",
  "truyen",
  "tu",
  "va",
  "ve",
  "voi",
  "what",
  "when",
  "where",
  "who",
  "why",
  "works"
]);

function compactTitleText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function removeDiacritics(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D");
}

function isProductVariantAttribute(value: string): boolean {
  const normalized = removeDiacritics(compactTitleText(value)).toLocaleLowerCase("vi-VN");

  if (!normalized || /\b(?:gia|vnd|isbn|sku|nha nam|nhanam|tb)\b/u.test(normalized)) {
    return false;
  }

  return /\b(?:khong kem|khong co|co kem|kem|hop|bia cung|bia mem|ban dac biet|limited)\b/u.test(normalized);
}

function extractProductVariantAttributeText(rawTitle: string): string {
  const attributes: string[] = [];
  const pattern = /\(([^()]+)\)|\[([^\[\]]+)\]|\{([^{}]+)\}|（([^（）]+)）|【([^【】]+)】/gu;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(rawTitle)) !== null) {
    const attribute = compactTitleText(match.slice(1).find((item) => typeof item === "string" && item.trim()) ?? "");
    if (attribute && isProductVariantAttribute(attribute)) {
      attributes.push(`(${attribute})`);
    }
  }

  return attributes
    .filter(
      (attribute, index, values) =>
        values.findIndex((item) => item.toLocaleLowerCase("vi-VN") === attribute.toLocaleLowerCase("vi-VN")) === index
    )
    .join(" ");
}

function stripNonVariantBracketedText(value: string): string {
  return compactTitleText(
    value.replace(/\(([^()]+)\)|\[([^\[\]]+)\]|\{([^{}]+)\}|（([^（）]+)）|【([^【】]+)】/gu, (match, ...groups) => {
      const attribute = compactTitleText(groups.find((item) => typeof item === "string" && item.trim()) ?? "");
      return isProductVariantAttribute(attribute) ? match : " ";
    })
  );
}

function isCapitalizedOrUppercaseWord(word: string): boolean {
  const firstLetter = word.match(/\p{L}/u)?.[0];
  return !!firstLetter && firstLetter === firstLetter.toLocaleUpperCase("vi-VN");
}

function looksLikeAuthorSuffix(value: string): boolean {
  if (!/^[A-Za-z.'\-\s]+$/.test(value.trim())) {
    return false;
  }

  const words = value.match(/[\p{L}.]+/gu) ?? [];
  if (words.length < 2 || words.length > 5) {
    return false;
  }

  const normalizedWords = words.map((word) => removeDiacritics(word).toLocaleLowerCase("vi-VN").replace(/\./g, ""));
  if (normalizedWords.some((word) => SUBTITLE_WORDS.has(word))) {
    return false;
  }

  return words.every(isCapitalizedOrUppercaseWord);
}

function looksLikeExistingSubtitle(value: string): boolean {
  const subtitle = stripNonVariantBracketedText(value);
  if (!subtitle || looksLikeAuthorSuffix(subtitle)) {
    return false;
  }

  const normalizedWords = removeDiacritics(subtitle).toLocaleLowerCase("vi-VN").match(/[\p{L}\p{N}]+/gu) ?? [];
  const normalizedText = normalizedWords.join(" ");
  if (/\b(?:tb|tai ban|gia|vnd|isbn|sku)\b/u.test(normalizedText) || /^\d/.test(normalizedText)) {
    return false;
  }

  return normalizedWords.length >= 2 && (normalizedWords.some((word) => SUBTITLE_WORDS.has(word)) || /[,;:]/u.test(subtitle));
}

function cleanExistingSubtitle(value: string): string | null {
  const subtitle = stripNonVariantBracketedText(value);
  if (!subtitle || looksLikeAuthorSuffix(subtitle)) {
    return null;
  }

  return subtitle;
}

function withOriginalProductAttributes(mainSourceTitle: string, rawTitle: string): string {
  const attributes = extractProductVariantAttributeText(rawTitle);
  return attributes ? `${mainSourceTitle} ${attributes}` : mainSourceTitle;
}

function readProductTitleParts(title: string, alias: string): ProductTitleParts {
  const lines = title
    .split(/\r?\n/)
    .map((line) => compactTitleText(line))
    .filter(Boolean);

  if (lines.length >= 2) {
    return {
      mainSourceTitle: withOriginalProductAttributes(lines[0] ?? title, title),
      existingSubtitle: cleanExistingSubtitle(lines.slice(1).join(" - "))
    };
  }

  const primaryTitle = readPrimaryTitle(title);
  if (isComboProductTitle(primaryTitle, alias)) {
    return {
      mainSourceTitle: primaryTitle,
      existingSubtitle: null
    };
  }

  const parts = primaryTitle
    .split(/\s+[-–—]\s+/u)
    .map((part) => compactTitleText(part))
    .filter(Boolean);

  if (parts.length === 2 && looksLikeExistingSubtitle(parts[1] ?? "")) {
    return {
      mainSourceTitle: withOriginalProductAttributes(parts[0] ?? primaryTitle, title),
      existingSubtitle: cleanExistingSubtitle(parts[1] ?? "")
    };
  }

  return {
    mainSourceTitle: primaryTitle,
    existingSubtitle: null
  };
}

function formatTitleWithSubtitle(mainTitle: string, subtitle: string): string {
  return `${compactTitleText(mainTitle)} - ${compactTitleText(subtitle).toLocaleUpperCase("vi-VN")}`;
}

function buildConfirmButtons(jobId: string): InlineKeyboardButton[][] {
  return [
    [{ text: "Đồng ý sửa", callback_data: `sp_confirm:${jobId}` }],
    [{ text: "Hủy", callback_data: `sp_cancel:${jobId}` }]
  ];
}

function formatFriendlyError(error: unknown): string {
  if (error instanceof AppError && error.code === "SAPO_PRODUCT_TITLE_VERIFY_FAILED") {
    return "Sapo trả OK nhưng product.title chưa đổi. Chưa xác nhận cập nhật thành công.";
  }

  if (error instanceof AppError) {
    return error.message;
  }

  return error instanceof Error ? error.message : "Lỗi hệ thống";
}

export async function handleNormalizeProductTitleCommand(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) {
    await replySafely(ctx, "Vui lòng dùng: /s https://nhanam.vn/<alias>");
    return;
  }

  if (!canEditProducts(userId)) {
    logger.warn("product_title_edit_forbidden", { userId });
    await replySafely(ctx, PRODUCT_EDIT_FORBIDDEN_MESSAGE, { userId });
    return;
  }

  const commandText = getMessageText(ctx);
  const productUrl = commandText.split(/\s+/).slice(1).join(" ").trim();
  const alias = extractNhanamProductAlias(productUrl);

  if (!alias) {
    await replySafely(ctx, "URL không hợp lệ. Vui lòng dùng: /s https://nhanam.vn/<alias>", { userId });
    return;
  }

  try {
    logger.info("product_title_normalize_started", { userId, alias });
    await replySafely(ctx, "Đang tìm sản phẩm và chuẩn hóa tên...", { userId, alias });

    const product = await sapoProductService.findProductByAlias(alias);
    if (!product || !product.id || !product.title) {
      logger.warn("sapo_product_not_found", { userId, alias, command: "s" });
      await replySafely(ctx, "Không tìm thấy sản phẩm tương ứng trong Sapo.", { userId, alias });
      return;
    }

    const isCombo = isComboProductTitle(product.title, alias);
    if (isCombo) {
      await replySafely(ctx, "Đây là sản phẩm combo. Bot đang search thêm nội dung từng sách rồi mới nhờ AI đặt tên combo...", {
        userId,
        alias,
        productId: product.id
      });
    }

    const newTitle = isCombo
      ? (await generateMarketingComboProductTitle(product, alias)).finalTitle
      : normalizeProductTitleForBook(product.title, { alias });

    if (!newTitle) {
      await replySafely(ctx, "Không tạo được tên mới sau khi chuẩn hóa. Chưa có thay đổi nào trên Sapo.", {
        userId,
        alias,
        productId: product.id
      });
      return;
    }

    if (newTitle === product.title) {
      await replySafely(
        ctx,
        [
          "Tên sản phẩm đã đúng chuẩn, chưa cần sửa.",
          "",
          `Tên hiện tại: ${product.title}`,
          buildProductUrl(alias)
        ].join("\n"),
        { userId, alias, productId: product.id }
      );
      return;
    }

    const job: ProductTitleUpdateJob = {
      jobId: randomUUID(),
      userId,
      productId: product.id,
      alias,
      oldTitle: product.title,
      newTitle,
      createdAt: Date.now()
    };

    saveProductTitleUpdateJob(job);
    logger.info("product_title_normalize_pending_created", {
      userId,
      jobId: job.jobId,
      productId: job.productId,
      alias,
      isCombo,
      oldTitle: job.oldTitle,
      newTitle: job.newTitle
    });

    await replyWithButtonsSafely(
      ctx,
      [
        "Đã chuẩn hóa tên sản phẩm:",
        "",
        `ID: ${job.productId}`,
        `Alias: ${job.alias}`,
        "",
        "Tên hiện tại:",
        job.oldTitle,
        "",
        "Tên sau chuẩn hóa:",
        job.newTitle,
        "",
        "Bạn có đồng ý sửa tên sản phẩm trên Sapo không?"
      ].join("\n"),
      buildConfirmButtons(job.jobId),
      { userId, jobId: job.jobId, productId: job.productId, alias }
    );
  } catch (error) {
    const reason = formatFriendlyError(error);
    logger.error("product_title_normalize_failed", { userId, alias, reason });
    await replySafely(ctx, `Không chuẩn hóa được tên sản phẩm: ${reason}`, { userId, alias });
  }
}

async function buildNormalizedMainTitle(
  product: NormalizedSapoProduct,
  alias: string,
  sourceTitle = readPrimaryTitle(product.title)
): Promise<string> {
  const primaryProductTitle = sourceTitle;
  const isCombo = isComboProductTitle(primaryProductTitle, alias);

  return isCombo
    ? (await generateMarketingComboProductTitle({ ...product, title: primaryProductTitle }, alias)).finalTitle
    : normalizeProductTitleForBook(primaryProductTitle, { alias });
}

export async function handleMarketingSubtitleTitleCommand(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) {
    await replySafely(ctx, "Vui lòng dùng: /s1 https://nhanam.vn/<alias>");
    return;
  }

  if (!canEditProducts(userId)) {
    logger.warn("product_title_edit_forbidden", { userId });
    await replySafely(ctx, PRODUCT_EDIT_FORBIDDEN_MESSAGE, { userId });
    return;
  }

  const commandText = getMessageText(ctx);
  const productUrl = commandText.split(/\s+/).slice(1).join(" ").trim();
  const alias = extractNhanamProductAlias(productUrl);

  if (!alias) {
    await replySafely(ctx, "URL không hợp lệ. Vui lòng dùng: /s1 https://nhanam.vn/<alias>", { userId });
    return;
  }

  try {
    logger.info("product_marketing_subtitle_started", { userId, alias });
    await replySafely(ctx, "Đang tìm sản phẩm, chuẩn hóa title chính và kiểm tra title phụ marketing...", { userId, alias });

    const product = await sapoProductService.findProductByAlias(alias);
    if (!product || !product.id || !product.title) {
      logger.warn("sapo_product_not_found", { userId, alias, command: "s1" });
      await replySafely(ctx, "Không tìm thấy sản phẩm tương ứng trong Sapo.", { userId, alias });
      return;
    }

    const titleParts = readProductTitleParts(product.title, alias);
    const mainTitle = await buildNormalizedMainTitle(product, alias, titleParts.mainSourceTitle);
    const subtitle =
      titleParts.existingSubtitle ??
      (await generateMarketingSubtitle({
        product,
        mainTitle,
        alias
      }));
    const newTitle = formatTitleWithSubtitle(mainTitle, subtitle);

    if (newTitle === product.title) {
      await replySafely(
        ctx,
        [
          "Tên sản phẩm đã có title phụ đúng chuẩn, chưa cần sửa.",
          "",
          `Tên hiện tại: ${product.title}`,
          buildProductUrl(alias)
        ].join("\n"),
        { userId, alias, productId: product.id }
      );
      return;
    }

    const job: ProductTitleUpdateJob = {
      jobId: randomUUID(),
      userId,
      productId: product.id,
      alias,
      oldTitle: product.title,
      newTitle,
      createdAt: Date.now()
    };

    saveProductTitleUpdateJob(job);
    logger.info("product_marketing_subtitle_pending_created", {
      userId,
      jobId: job.jobId,
      productId: job.productId,
      alias,
      oldTitle: job.oldTitle,
      newTitle: job.newTitle
    });

    await replyWithButtonsSafely(
      ctx,
      [
        "Đã tạo title phụ marketing:",
        "",
        `ID: ${job.productId}`,
        `Alias: ${job.alias}`,
        "",
        "Tên hiện tại:",
        job.oldTitle,
        "",
        "Tên sau chuẩn hóa:",
        job.newTitle,
        "",
        "Bạn có đồng ý sửa tên sản phẩm trên Sapo không?"
      ].join("\n"),
      buildConfirmButtons(job.jobId),
      { userId, jobId: job.jobId, productId: job.productId, alias }
    );
  } catch (error) {
    const reason = formatFriendlyError(error);
    logger.error("product_marketing_subtitle_failed", { userId, alias, reason });
    await replySafely(ctx, `Không tạo được title phụ marketing: ${reason}`, { userId, alias });
  }
}

export async function handleProductTitleCallback(ctx: Context): Promise<boolean> {
  const userId = ctx.from?.id;
  const data = getCallbackData(ctx);

  if (!userId || !data) {
    return false;
  }

  const [action, jobId] = data.split(":");
  if (!action || !jobId || !action.startsWith("sp_")) {
    return false;
  }

  await answerCallbackSafely(ctx);

  const job = getProductTitleUpdateJob(jobId, userId);
  if (!job) {
    await replySafely(ctx, "Job xác nhận đã hết hạn hoặc không thuộc user này.", { userId, jobId });
    return true;
  }

  if (action === "sp_cancel") {
    deleteProductTitleUpdateJob(jobId);
    logger.info("product_title_update_cancelled", { userId, jobId, productId: job.productId, alias: job.alias });
    await replySafely(ctx, "Đã hủy. Chưa có thay đổi nào trên Sapo.", { userId, jobId });
    return true;
  }

  if (action !== "sp_confirm") {
    return true;
  }

  if (!canEditProducts(userId)) {
    logger.warn("product_title_edit_forbidden", { userId, jobId, productId: job.productId, alias: job.alias });
    await replySafely(ctx, PRODUCT_EDIT_FORBIDDEN_MESSAGE, { userId, jobId });
    return true;
  }

  try {
    await replySafely(ctx, "Đang cập nhật tên sản phẩm trên Sapo...", {
      userId,
      jobId,
      productId: job.productId,
      alias: job.alias
    });
    await sapoProductService.updateProductTitle(job.productId, job.newTitle, {
      userId,
      jobId,
      alias: job.alias
    });

    deleteProductTitleUpdateJob(jobId);
    logger.info("product_title_update_success", {
      userId,
      jobId,
      productId: job.productId,
      alias: job.alias,
      oldTitle: job.oldTitle,
      newTitle: job.newTitle
    });

    await replySafely(
      ctx,
      [
        "Đã cập nhật tên sản phẩm:",
        "",
        job.newTitle,
        buildProductUrl(job.alias)
      ].join("\n"),
      { userId, jobId, productId: job.productId, alias: job.alias }
    );
  } catch (error) {
    const reason = formatFriendlyError(error);
    logger.error("product_title_update_failed", {
      userId,
      jobId,
      productId: job.productId,
      alias: job.alias,
      reason
    });
    await replySafely(ctx, `Update Sapo thất bại: ${reason}`, {
      userId,
      jobId,
      productId: job.productId,
      alias: job.alias
    });
  }

  return true;
}
