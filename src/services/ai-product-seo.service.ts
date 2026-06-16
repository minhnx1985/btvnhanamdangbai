import { applyReadableSpacingToHtml } from "./content.service";
import { shopApiService } from "./shopapi.service";
import {
  ProductSeoMarketingInput,
  ProductSeoMarketingResult
} from "../types/product-seo.types";
import { AppError } from "../utils/errors";

const ALLOWED_HTML_TAGS = new Set(["p", "h2", "h3", "strong", "em", "ul", "li"]);

type RawAiProductSeoResult = {
  seoTitle?: unknown;
  metaDescription?: unknown;
  productDescriptionHtml?: unknown;
  marketingBlocksHtml?: unknown;
  finalBodyHtml?: unknown;
  telegramPreview?: unknown;
  improvedSeoScore?: unknown;
  improvedMarketingScore?: unknown;
  warnings?: unknown;
};

export async function generateProductSeoMarketing(
  input: ProductSeoMarketingInput
): Promise<ProductSeoMarketingResult> {
  const result = await shopApiService.generateJson<RawAiProductSeoResult>([
    {
      role: "system",
      content: [
        "Bạn là trợ lý SEO và marketing nội dung sản phẩm sách cho website Nhã Nam.",
        "",
        "Nhiệm vụ:",
        "Tối ưu trang sản phẩm dựa hoàn toàn trên dữ liệu được cung cấp.",
        "",
        "Bạn cần tạo:",
        "1. Meta title",
        "2. Meta description",
        "3. Mô tả sản phẩm HTML",
        "4. Khối marketing/conversion",
        "5. Cảnh báo dữ liệu bất thường nếu có",
        "",
        "Nguyên tắc bắt buộc:",
        "- Không bịa thông tin ngoài dữ liệu đầu vào.",
        "- Không thêm giải thưởng, độ tuổi, review, nội dung sách nếu dữ liệu không có.",
        "- Không thay đổi tên sách, tác giả, NXB, số trang, giá, mã sản phẩm.",
        "- Nếu dữ liệu thiếu, hãy viết trung tính hoặc bỏ section đó.",
        "- Không dùng giọng quảng cáo quá đà.",
        "- Không dùng các cụm sáo: \"không chỉ... mà còn\", \"điều thú vị là\", \"hành trình khám phá\", \"mở ra cánh cửa\", \"đắm chìm\", \"cuốn sách không thể bỏ qua\".",
        "- Tránh văn AI, tránh câu rỗng, tránh lặp ý.",
        "- Văn phong: biên tập, rõ, đáng tin, phù hợp Nhã Nam.",
        "- SEO nhẹ nhàng, không nhồi keyword.",
        "- HTML sạch cho CMS.",
        "- Chỉ dùng thẻ: p, h2, h3, strong, em, ul, li.",
        "- Không dùng img, iframe, script.",
        "- Không dùng markdown.",
        "",
        "Cấu trúc mô tả đề xuất:",
        "- Giới thiệu sách",
        "- Điểm nổi bật",
        "- Cuốn sách phù hợp với ai?",
        "- Thông tin xuất bản nếu có dữ liệu",
        "- CTA mềm nếu phù hợp",
        "",
        "Output bắt buộc là JSON hợp lệ:",
        "{\"seoTitle\":\"...\",\"metaDescription\":\"...\",\"productDescriptionHtml\":\"...\",\"marketingBlocksHtml\":\"...\",\"finalBodyHtml\":\"...\",\"telegramPreview\":\"...\",\"improvedSeoScore\":0,\"improvedMarketingScore\":0,\"warnings\":[]}"
      ].join("\n")
    },
    {
      role: "user",
      content: JSON.stringify({
        product: {
          id: input.product.id,
          title: input.product.title,
          alias: input.product.alias,
          handle: input.product.handle,
          bodyHtml: input.product.bodyHtml,
          description: input.product.description,
          vendor: input.product.vendor,
          productType: input.product.productType,
          tags: input.product.tags,
          variants: input.product.variants,
          seoTitle: input.product.seoTitle ?? input.product.metaTitle,
          metaDescription: input.product.metaDescription ?? input.product.seoDescription
        },
        audit: input.audit
      })
    }
  ]);

  return normalizeAiResult(result);
}

function normalizeAiResult(result: RawAiProductSeoResult): ProductSeoMarketingResult {
  const seoTitle = readRequiredString(result.seoTitle, "seoTitle").slice(0, 70);
  const metaDescription = readRequiredString(result.metaDescription, "metaDescription").slice(0, 170);
  const productDescriptionHtml = sanitizeHtml(readRequiredString(result.productDescriptionHtml, "productDescriptionHtml"));
  const marketingBlocksHtml = sanitizeHtml(readRequiredString(result.marketingBlocksHtml, "marketingBlocksHtml"));
  const finalBodyHtml = applyReadableSpacingToHtml(sanitizeHtml(readRequiredString(result.finalBodyHtml, "finalBodyHtml")));
  const telegramPreview = readRequiredString(result.telegramPreview, "telegramPreview");

  return {
    seoTitle,
    metaDescription,
    productDescriptionHtml,
    marketingBlocksHtml,
    finalBodyHtml,
    telegramPreview,
    improvedSeoScore: readScore(result.improvedSeoScore),
    improvedMarketingScore: readScore(result.improvedMarketingScore),
    warnings: Array.isArray(result.warnings)
      ? result.warnings.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean)
      : []
  };
}

function readRequiredString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new AppError(`AI thiếu field bắt buộc: ${fieldName}`, "AI_PRODUCT_SEO_INVALID_RESPONSE");
  }

  return value.trim();
}

function readScore(value: unknown): number {
  const numberValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numberValue)) {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.round(numberValue)));
}

function sanitizeHtml(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<\/?([a-zA-Z][a-zA-Z0-9-]*)(?:\s[^>]*)?>/g, (fullTag, tagName: string) => {
      const normalizedTag = tagName.toLowerCase();
      if (!ALLOWED_HTML_TAGS.has(normalizedTag)) {
        return "";
      }

      return fullTag.startsWith("</") ? `</${normalizedTag}>` : `<${normalizedTag}>`;
    });
}
