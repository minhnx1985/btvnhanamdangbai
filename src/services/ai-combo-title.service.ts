import { NormalizedSapoProduct } from "../types/product-seo.types";
import { AppError } from "../utils/errors";
import { logger } from "../utils/logger";
import { stripHtml } from "./product-audit.service";
import { formatMarketingComboProductTitle } from "./product-title-normalizer.service";
import { ShopApiChatMessage, shopApiService } from "./shopapi.service";

type RawComboTitleResult = {
  comboName?: unknown;
  bookTitles?: unknown;
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
    .replace(/^(?:combo\s+)?\d+\s*/iu, "")
    .replace(/[:：].*$/u, "")
    .replace(/[“”"']/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function sanitizeBookTitles(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => (typeof item === "string" ? sanitizeBookTitle(item) : ""))
    .filter(Boolean)
    .filter((title, index, titles) => titles.findIndex((item) => item.toLocaleLowerCase("vi-VN") === title.toLocaleLowerCase("vi-VN")) === index)
    .slice(0, 8);
}

function sanitizeBookTitle(value: string): string {
  return value
    .replace(/^combo\s*\+?/iu, "")
    .replace(/^(?:combo\s+)?\d+\s*(?:[-–—]\s*)?/iu, "")
    .replace(/^(?:combo sách|combo sach|bộ combo|bo combo|combo)\s*[:：\-–—+]?\s*/iu, "")
    .replace(/[“”"']/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function buildMessages(
  product: NormalizedSapoProduct
): ShopApiChatMessage[] {
  return [
    {
      role: "system",
      content: [
        "Bạn là biên tập viên marketing sách của Nhã Nam.",
        "Nhiệm vụ: đọc toàn bộ dữ liệu combo và tự quyết định tên combo sau chuẩn hóa.",
        "AI chịu trách nhiệm cả hai việc: đặt comboName và nhận diện các tên sách thật sự có trong combo.",
        "Không bịa thông tin, không thêm giải thưởng, không dùng giọng quá đà.",
        "Không đưa số catalog như 120, 174, 175, 001 vào comboName hoặc bookTitles.",
        "Tên combo phải là một cụm danh từ/cụm mô tả ngắn, không quá 8 từ.",
        "Không dùng từ COMBO trong comboName.",
        "Không đưa danh sách tên sách vào comboName.",
        "Không dùng dấu hai chấm trong comboName.",
        "bookTitles chỉ gồm tên các cuốn sách cụ thể thật sự có trong combo.",
        "Không đưa các mô tả bộ như 'Bộ triết 5 cuốn', 'Combo tác giả...', 'Trọn bộ...', 'Tủ sách...' vào bookTitles nếu đó không phải tên sách.",
        "Nếu tên hiện tại chỉ có mã combo/chủ đề/tác giả hoặc mô tả bộ, không có tên sách cụ thể, trả bookTitles là mảng rỗng [].",
        "Tên sau cùng sẽ được code format thành: COMBO <comboName>: <book 1> - <book 2>.",
        "Nếu bookTitles rỗng, code sẽ format thành: COMBO <comboName>.",
        "Output bắt buộc là JSON hợp lệ dạng {\"comboName\":\"...\",\"bookTitles\":[\"...\"]}.",
        "Không markdown, không giải thích ngoài JSON."
      ].join("\n")
    },
    {
      role: "user",
      content: JSON.stringify({
        currentProductTitle: product.title,
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
  const startedAt = Date.now();
  logger.info("ai_combo_title_generation_started", {
    productId: product.id,
    alias
  });

  const result = await shopApiService.generateJson<RawComboTitleResult>(buildMessages(product));
  const comboName = sanitizeComboName(result.comboName);
  if (!comboName) {
    throw new AppError("AI không trả tên combo hợp lệ", "AI_COMBO_TITLE_INVALID_RESPONSE");
  }

  const bookTitles = sanitizeBookTitles(result.bookTitles);
  const finalTitle = formatMarketingComboProductTitle(comboName, bookTitles);
  if (!finalTitle) {
    throw new AppError("Không tạo được tên combo sau khi AI trả kết quả", "COMBO_TITLE_FORMAT_FAILED");
  }

  logger.info("ai_combo_title_generated", {
    productId: product.id,
    alias,
    comboName,
    bookTitlesCount: bookTitles.length,
    durationMs: Date.now() - startedAt
  });

  return { finalTitle, comboName, bookTitles };
}
