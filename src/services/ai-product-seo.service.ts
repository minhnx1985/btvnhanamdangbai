import { shopApiService, ShopApiChatMessage } from "./shopapi.service";
import { ProductSeoMarketingInput, ProductSeoMarketingResult } from "../types/product-seo.types";
import { AppError } from "../utils/errors";
import { stripHtml } from "./product-audit.service";

const ALLOWED_HTML_TAGS = new Set(["p", "h2", "h3", "strong", "em", "ul", "li"]);
const MIN_FINAL_TEXT_LENGTH = 80;
const FORBIDDEN_FILLER_PATTERNS = [
  /kh(?:o|Ã´)ng ch(?:i|á»‰)[\s\S]{0,80}m(?:a|Ã ) c(?:o|Ã²)n/i,
  /mang (?:den|Ä‘áº¿n) cho (?:doc gia|Ä‘á»™c giáº£)/i,
  /h(?:a|Ã )nh tr(?:i|Ã¬)nh (?:day|Ä‘áº§y) c(?:a|áº£)m x(?:u|Ãº)c/i,
  /si(?:e|Ãª)u ph(?:a|áº©)m/i,
  /g(?:a|Ã¢)y b(?:a|Ã£)o/i,
  /kh(?:o|Ã´)ng th(?:e|á»ƒ) b(?:o|á») l(?:o|á»¡)/i,
  /n(?:o|Æ¡)i m(?:a|Ã )/i,
  /bìa mềm dễ cầm đọc/i,
  /thuận tiện bổ sung vào tủ sách/i,
  /phù hợp làm quà tặng/i,
  /số trang phù hợp để đọc lâu hơn/i,
  /khổ sách dễ mang theo/i
];

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

export async function generateProductSeoMarketing(input: ProductSeoMarketingInput): Promise<ProductSeoMarketingResult> {
  const result = await generateWriterJson([
    {
      role: "system",
      content: [
        "You are a senior Vietnamese publishing marketer and copy strategist working for Nha Nam.",
        "",
        "Brand principles:",
        "- Nha Nam is literary, trustworthy, intellectually curious, culturally grounded, reader-first, and commercially aware without sounding commercial.",
        "- Prefer specificity, substance, context, and genuine reader value.",
        "- Avoid hype, clickbait, empty praise, exaggerated emotion, generic AI phrasing, and unsupported claims.",
        "",
        "Core principle before writing:",
        "- First determine the objective: awareness, traffic, engagement, conversion, preorder, or brand building.",
        "- Then determine the audience from Book DNA: literary readers, general readers, parents, teachers, children, nonfiction readers, economics/politics readers, existing fans, or cold audience.",
        "- Then determine the platform. For this task, the platform is the Nha Nam product page / landing page.",
        "- Choose the most suitable communication structure only after those decisions.",
        "",
        "Framework selection:",
        "- Use AIDA, PAS, FAB, BAB, 4C, Hook -> Value -> CTA, Storytelling, 5W1H, or PPPP only when it naturally fits.",
        "- Never force a framework. Clarity beats cleverness.",
        "- Do not mention the selected framework in the output.",
        "",
        "Psychological and NLP principles:",
        "- Use curiosity, specificity, authority, social proof, contrast, future pacing, identity, community, and relevance when grounded in data.",
        "- Use scarcity or urgency only when true.",
        "- Use pacing and leading, sensory detail, open loops, narrative tension, reader identity, and conversational flow naturally.",
        "- Avoid manipulation.",
        "",
        "Publishing-specific rules:",
        "- Literary fiction: emphasize voice, atmosphere, themes, translation, and author reputation when supported.",
        "- Genre fiction: emphasize plot, mystery, stakes, and worldbuilding when supported.",
        "- Nonfiction: emphasize insight, usefulness, authority, and relevance.",
        "- Children's books: emphasize emotion, reading experience, and parent-child value.",
        "- Politics, economics, history: emphasize expertise, context, timeliness, and evidence.",
        "- Combo products: emphasize the real buying logic: complete set, same author/series/theme, or convenience, only when supported.",
        "",
        "Additional hard rules:",
        "- Never fabricate awards, reviews, bestseller status, sales numbers, endorsements, or media coverage.",
        "- Avoid overusing: \"khong chi... ma con\", \"mang den cho doc gia\", \"hanh trinh day cam xuc\", \"sieu pham\", \"gay bao\", \"khong the bo lo\", \"noi ma\".",
        "- Every paragraph must give the reader a real reason to click, read, or buy.",
        "- Prefer intelligent simplicity over marketing noise.",
        "",
        "Final quality check before returning JSON:",
        "- Is there a real reason to click, read, or buy?",
        "- Is it specific?",
        "- Is it true?",
        "- Does it sound like Nha Nam?",
        "- Does it respect HTML/platform constraints?",
        "- Would a real editor approve it?",
        "",
        "Bạn là trợ lý SEO và marketing nội dung sản phẩm sách cho website Nhã Nam.",
        "",
        "Bạn sẽ nhận:",
        "1. Dữ liệu sản phẩm từ Sapo",
        "2. SEO/marketing audit",
        "3. Book DNA Analysis",
        "",
        "Nhiệm vụ:",
        "Viết lại mô tả sản phẩm dựa trên Book DNA, đồng thời tối ưu SEO nhẹ nhàng.",
        "",
        "Ưu tiên:",
        "1. Đúng bản chất cuốn sách",
        "2. Có angle marketing rõ",
        "3. Có ích cho người mua",
        "4. Tự nhiên, không văn AI",
        "5. SEO vừa đủ, không nhồi từ khóa",
        "",
        "Luật bắt buộc:",
        "- Phải viết dựa trên Book DNA Analysis.",
        "- Không được tự tạo angle mới trái với Book DNA.",
        "- Không bịa thông tin ngoài dữ liệu và Book DNA.",
        "- Không thêm giải thưởng, độ tuổi, review, nội dung sách nếu dữ liệu không có.",
        "- Không thay đổi tên sách, tác giả, NXB, số trang, giá, mã sản phẩm.",
        "- Nếu Book DNA confidence < 50, phải viết thận trọng, ngắn hơn, và cảnh báo thiếu dữ liệu.",
        "- Nếu Book DNA có forbiddenClaims, tuyệt đối tránh các claim đó.",
        "- Không dùng giọng quảng cáo quá đà.",
        "- Không dùng các cụm sáo: \"không chỉ... mà còn\", \"điều thú vị là\", \"hành trình khám phá\", \"mở ra cánh cửa\", \"đắm chìm\", \"cuốn sách không thể bỏ qua\".",
        "- Không dùng filler: \"bìa mềm dễ cầm đọc\", \"thuận tiện bổ sung vào tủ sách\", \"phù hợp làm quà tặng\", \"số trang phù hợp để đọc lâu hơn\", \"khổ sách dễ mang theo\".",
        "- Không biến thông tin kỹ thuật thành điểm bán hàng chính.",
        "",
        "Cấu trúc HTML:",
        "- h2 Giới thiệu sách",
        "- h2 Vì sao nên đọc / Điểm nổi bật / Cuốn sách này dành cho ai",
        "- h2 Thông tin xuất bản nếu có dữ liệu",
        "- CTA mềm nếu phù hợp",
        "",
        "Chỉ dùng thẻ:",
        "p, h2, h3, strong, em, ul, li",
        "",
        "Không dùng:",
        "markdown, inline style, img, iframe, script",
        "",
        "Output JSON:",
        JSON.stringify({
          seoTitle: "",
          metaDescription: "",
          productDescriptionHtml: "",
          marketingBlocksHtml: "",
          finalBodyHtml: "",
          telegramPreview: "",
          improvedSeoScore: 0,
          improvedMarketingScore: 0,
          warnings: []
        }),
        "",
        "Không markdown, không giải thích ngoài JSON."
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
          content: input.product.content,
          summary: input.product.summary,
          vendor: input.product.vendor,
          productType: input.product.productType,
          tags: input.product.tags,
          variants: input.product.variants,
          seoTitle: input.product.seoTitle ?? input.product.metaTitle,
          metaDescription: input.product.metaDescription ?? input.product.seoDescription
        },
        audit: input.audit,
        bookDNA: input.bookDNA
      })
    }
  ]);

  return normalizeAiResult(result, input.bookDNA.confidence);
}

async function generateWriterJson(messages: ShopApiChatMessage[]): Promise<RawAiProductSeoResult> {
  try {
    return await shopApiService.generateJson<RawAiProductSeoResult>(messages);
  } catch (error) {
    if (error instanceof AppError && error.code === "AI_JSON_PARSE_FAILED") {
      throw new AppError("Writer JSON parse fail", "WRITER_JSON_PARSE_FAILED");
    }

    throw error;
  }
}

function normalizeAiResult(result: RawAiProductSeoResult, bookDNAConfidence: number): ProductSeoMarketingResult {
  const seoTitle = readRequiredString(result.seoTitle, "seoTitle").slice(0, 70);
  const metaDescription = readRequiredString(result.metaDescription, "metaDescription").slice(0, 170);
  const productDescriptionHtml = validateHtml(
    sanitizeProductDescriptionHtml(readRequiredString(result.productDescriptionHtml, "productDescriptionHtml")),
    "productDescriptionHtml"
  );
  const marketingBlocksHtml = validateHtml(
    sanitizeProductDescriptionHtml(readRequiredString(result.marketingBlocksHtml, "marketingBlocksHtml")),
    "marketingBlocksHtml"
  );
  const finalBodyHtml = validateHtml(
    sanitizeProductDescriptionHtml(readRequiredString(result.finalBodyHtml, "finalBodyHtml")),
    "finalBodyHtml"
  );
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
    warnings: [
      ...(bookDNAConfidence < 50
        ? ["Book DNA confidence thấp; mô tả cần thận trọng vì dữ liệu sản phẩm còn thiếu."]
        : []),
      ...(Array.isArray(result.warnings)
        ? result.warnings.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean)
        : [])
    ]
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

export function sanitizeProductDescriptionHtml(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, "")
    .replace(/<img[^>]*>/gi, "")
    .replace(/<\/?([a-zA-Z][a-zA-Z0-9-]*)(?:\s[^>]*)?>/g, (fullTag, tagName: string) => {
      const normalizedTag = tagName.toLowerCase();
      if (!ALLOWED_HTML_TAGS.has(normalizedTag)) {
        return "";
      }

      return fullTag.startsWith("</") ? `</${normalizedTag}>` : `<${normalizedTag}>`;
    });
}

function validateHtml(html: string, fieldName: string): string {
  const plainText = stripHtml(html);
  if (!plainText || plainText.length < MIN_FINAL_TEXT_LENGTH) {
    throw new AppError(`HTML sau sanitize rỗng hoặc quá ngắn: ${fieldName}`, "AI_PRODUCT_SEO_HTML_TOO_SHORT");
  }

  if (/<script|<iframe|<img|style=/i.test(html)) {
    throw new AppError(`HTML sau sanitize còn chứa tag/attribute không hợp lệ: ${fieldName}`, "AI_PRODUCT_SEO_UNSAFE_HTML");
  }

  if (FORBIDDEN_FILLER_PATTERNS.some((pattern) => pattern.test(plainText))) {
    throw new AppError(`HTML sau sanitize còn chứa filler bị cấm: ${fieldName}`, "AI_PRODUCT_SEO_FORBIDDEN_FILLER");
  }

  return html;
}
