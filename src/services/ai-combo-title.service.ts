import { NormalizedSapoProduct } from "../types/product-seo.types";
import { AppError } from "../utils/errors";
import { logger } from "../utils/logger";
import { stripHtml } from "./product-audit.service";
import { extractComboBookTitles, formatMarketingComboProductTitle } from "./product-title-normalizer.service";
import { ShopApiChatMessage, shopApiService } from "./shopapi.service";

type RawComboTitleResult = {
  comboName?: unknown;
};

function truncateText(value: string | undefined, maxLength: number): string {
  const text = (value ?? "").trim();
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength).trim()}...`;
}

function sanitizeComboName(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }

  return value
    .replace(/^combo\s*\+?/iu, "")
    .replace(/[:：].*$/u, "")
    .replace(/[“”"']/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function buildMessages(product: NormalizedSapoProduct, bookTitles: string[]): ShopApiChatMessage[] {
  return [
    {
      role: "system",
      content: [
        "Bạn là biên tập viên marketing sách của Nhã Nam.",
        "Nhiệm vụ: đặt một tên combo ngắn, hấp dẫn, có tính marketing, dựa hoàn toàn trên dữ liệu được cung cấp.",
        "Không bịa thông tin, không thêm giải thưởng, không dùng giọng quá đà.",
        "Tên combo phải là một cụm danh từ/cụm mô tả ngắn, không quá 8 từ.",
        "Không dùng từ COMBO trong comboName.",
        "Không đưa danh sách tên sách vào comboName.",
        "Không dùng dấu hai chấm trong comboName.",
        "Output bắt buộc là JSON hợp lệ dạng {\"comboName\":\"...\"}.",
        "Không markdown, không giải thích ngoài JSON."
      ].join("\n")
    },
    {
      role: "user",
      content: JSON.stringify({
        currentProductTitle: product.title,
        bookTitles,
        productSummary: truncateText(stripHtml(product.summary ?? ""), 1200),
        productDescription: truncateText(stripHtml(product.content ?? ""), 1800),
        tags: product.tags ?? [],
        productType: product.productType,
        vendor: product.vendor
      })
    }
  ];
}

export async function generateMarketingComboProductTitle(
  product: NormalizedSapoProduct,
  alias: string
): Promise<{ finalTitle: string; comboName: string; bookTitles: string[] }> {
  const bookTitles = extractComboBookTitles(product.title);
  if (bookTitles.length === 0) {
    throw new AppError("Không tách được tên sách trong combo", "COMBO_BOOK_TITLES_MISSING");
  }

  const result = await shopApiService.generateJson<RawComboTitleResult>(buildMessages(product, bookTitles));
  const comboName = sanitizeComboName(result.comboName);
  if (!comboName) {
    throw new AppError("AI không trả tên combo hợp lệ", "AI_COMBO_TITLE_INVALID_RESPONSE");
  }

  const finalTitle = formatMarketingComboProductTitle(comboName, bookTitles);
  if (!finalTitle) {
    throw new AppError("Không tạo được tên combo sau khi AI trả kết quả", "COMBO_TITLE_FORMAT_FAILED");
  }

  logger.info("ai_combo_title_generated", {
    productId: product.id,
    alias,
    comboName,
    bookTitlesCount: bookTitles.length
  });

  return { finalTitle, comboName, bookTitles };
}
