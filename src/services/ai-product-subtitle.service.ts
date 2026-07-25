import { NormalizedSapoProduct, ProductResearchSource } from "../types/product-seo.types";
import { AppError } from "../utils/errors";
import { logger } from "../utils/logger";
import { stripHtml } from "./product-audit.service";
import { productResearchService } from "./product-research.service";
import { ShopApiChatMessage, shopApiService } from "./shopapi.service";

type RawMarketingSubtitleResult = {
  subtitle?: unknown;
};

type MarketingSubtitleInput = {
  product: NormalizedSapoProduct;
  mainTitle: string;
  alias: string;
};

const MAX_SUBTITLE_LENGTH = 110;

function truncateText(value: string | undefined, maxLength: number): string {
  const text = (value ?? "").trim();
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength).trim()}...`;
}

function sanitizeSubtitle(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }

  return value
    .replace(/^subtitle\s*[:：]\s*/iu, "")
    .replace(/^title\s*phụ\s*[:：]\s*/iu, "")
    .replace(/[“”"']/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_SUBTITLE_LENGTH)
    .trim();
}

function compactResearchSources(sources: ProductResearchSource[]): Array<{
  source: string;
  title: string;
  url?: string;
  summary: string;
}> {
  return sources.slice(0, 6).map((source) => ({
    source: source.source,
    title: source.title,
    url: source.url,
    summary: truncateText(source.summary, 700)
  }));
}

function buildMessages(input: MarketingSubtitleInput, researchSources: ProductResearchSource[]): ShopApiChatMessage[] {
  return [
    {
      role: "system",
      content: [
        "Bạn là biên tập viên marketing sách của Nhã Nam.",
        "Nhiệm vụ: tạo một dòng title phụ ngắn đặt ngay sau title chính của sản phẩm.",
        "Title phụ phải tăng tính marketing bằng insight độc giả, định vị cảm xúc/lợi ích, tò mò, nhận diện nhu cầu, hoặc lời hứa đọc sách.",
        "Áp dụng tâm lý học marketing một cách tinh tế: curiosity, identity, relevance, contrast, future pacing, social meaning, emotional promise.",
        "Không dùng giọng quảng cáo quá đà, không sáo rỗng, không clickbait.",
        "Không bịa giải thưởng, review, bestseller, độ tuổi, nội dung hoặc claim nếu dữ liệu không có.",
        "Không nhắc giá, ISBN, SKU, mã combo, mã catalog, số trang, kích thước.",
        "Không lặp lại title chính, không đưa tên tác giả như thông tin kỹ thuật nếu không tạo thêm giá trị marketing.",
        "Không dùng emoji, không markdown, không xuống dòng trong subtitle.",
        "Subtitle nên dài 8-18 từ, tối đa 110 ký tự.",
        "Output bắt buộc là JSON hợp lệ dạng {\"subtitle\":\"...\"}.",
        "Không giải thích ngoài JSON."
      ].join("\n")
    },
    {
      role: "user",
      content: JSON.stringify({
        currentProductTitle: input.product.title,
        mainTitle: input.mainTitle,
        productSummary: truncateText(stripHtml(input.product.summary ?? ""), 1200),
        productDescription: truncateText(stripHtml(input.product.content ?? ""), 1800),
        researchSources: compactResearchSources(researchSources),
        tags: input.product.tags ?? [],
        productType: input.product.productType,
        vendor: input.product.vendor
      })
    }
  ];
}

export async function generateMarketingSubtitle(input: MarketingSubtitleInput): Promise<string> {
  const startedAt = Date.now();
  logger.info("marketing_subtitle_generation_started", {
    productId: input.product.id,
    alias: input.alias
  });

  const researchSources = await productResearchService.researchProduct(input.product);
  const result = await shopApiService.generateJson<RawMarketingSubtitleResult>(buildMessages(input, researchSources));
  const subtitle = sanitizeSubtitle(result.subtitle);

  if (!subtitle) {
    throw new AppError("AI không trả title phụ hợp lệ", "AI_MARKETING_SUBTITLE_INVALID_RESPONSE");
  }

  logger.info("marketing_subtitle_generated", {
    productId: input.product.id,
    alias: input.alias,
    subtitle,
    sourcesCount: researchSources.length,
    durationMs: Date.now() - startedAt
  });

  return subtitle;
}
