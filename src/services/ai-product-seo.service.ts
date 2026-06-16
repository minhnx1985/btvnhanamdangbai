import { shopApiService, ShopApiChatMessage } from "./shopapi.service";
import { NormalizedSapoProduct, ProductSeoMarketingInput, ProductSeoMarketingResult } from "../types/product-seo.types";
import { AppError } from "../utils/errors";
import { getBookDnaMarketingStrategyPrompt } from "./book-dna-marketing-strategy.service";
import { stripHtml } from "./product-audit.service";

const ALLOWED_HTML_TAGS = new Set(["p", "h2", "h3", "strong", "em", "ul", "li"]);
const MIN_FINAL_TEXT_LENGTH = 80;
const MIN_BLOCK_TEXT_LENGTH = 20;
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

const FORBIDDEN_NORMALIZED_PHRASES = [
  "du lieu hien co cho thay",
  "bia mem de cam doc",
  "thuan tien bo sung vao tu sach",
  "phu hop lam qua tang",
  "428 trang phu hop de doc lau hon",
  "so trang phu hop de doc lau hon",
  "kho sach de mang theo",
  "khong chi",
  "mang den cho doc gia",
  "hanh trinh day cam xuc",
  "sieu pham",
  "gay bao",
  "khong the bo lo",
  "noi ma",
  "vi sao nen doc / diem noi bat / cuon sach nay danh cho ai",
  "hop neu ban dang tim",
  "neu ban can",
  "lua chon dang can nhac",
  "xem chi tiet ngay tren trang sach",
  "dat mua",
  "mua ngay",
  "them vao gio",
  "call to action",
  "cta mem",
  "diem khien",
  "diem hap dan",
  "diem noi bat cua",
  "gia tri cua",
  "day la mot lua chon",
  "lua chon tu nhien",
  "lua chon phu hop",
  "lua chon dang can nhac",
  "gia tri suu tam",
  "co them gia tri suu tam",
  "isbn",
  "sku",
  "ma san pham",
  "gia ban",
  "gia bia",
  "ngay phat hanh",
  "nam phat hanh"
];

const FORBIDDEN_AI_CONTENT_PATTERNS = [
  /\bISBN\b/i,
  /\bSKU\b/i,
  /\bbarcode\b/i,
  /\bprice\b/i,
  /\bgi(?:a|á)\s*(?:b(?:a|á)n|bia|bìa)\b/i,
  /\bm(?:a|ã)\s*(?:s(?:a|ả)n\s*ph(?:a|ẩ)m|sku)\b/i,
  /\bng(?:a|à)y\s*ph(?:a|á)t\s*h(?:a|à)nh\b/i,
  /\bn(?:a|ă)m\s*ph(?:a|á)t\s*h(?:a|à)nh\b/i
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
  ensureBookUnderstandingReady(input);

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
        "- Follow this exact flow: Product Data -> Book Understanding -> Positioning -> Framework Selection -> Writing.",
        "- Do not write from metadata. Metadata can appear only as support or final publication information.",
        "- Do not write unless Book DNA has Reader DNA, Buyer DNA, Reading Experience, Core Promise, Competitive Advantage, Positioning Statement, and Selected Framework.",
        "",
        "Human Observation Layer:",
        "- Before writing, find the most human observation about the book.",
        "- Start there.",
        "- Do not start with book category, book format, product summary, or \"this book is...\".",
        "- Start with an observation, a question, a familiar situation, a tension, or a feeling the target reader recognizes.",
        "- Write like an editor opening a conversation, not a SEO tool explaining a product.",
        "- Avoid analytical scaffolding phrases such as \"Điểm khiến...\", \"Điểm hấp dẫn...\", \"Điểm nổi bật...\", \"Giá trị của...\", \"Đây là một lựa chọn...\".",
        "",
        getBookDnaMarketingStrategyPrompt(),
        "- First determine the objective: awareness, traffic, engagement, conversion, preorder, or brand building.",
        "- Then determine the audience from Book DNA: literary readers, general readers, parents, teachers, children, nonfiction readers, economics/politics readers, existing fans, or cold audience.",
        "- Then determine the platform. For this task, the platform is the Nha Nam product page / landing page.",
        "- Choose the most suitable communication structure only after those decisions.",
        "",
        "Framework selection:",
        "- Use AIDA, PAS, FAB, BAB, 4C, Storytelling, 5W1H, or PPPP only when it naturally fits.",
        "- Never force a framework. Clarity beats cleverness.",
        "- Do not mention the selected framework in the output.",
        "",
        "Psychological and NLP principles:",
        "- Use curiosity, specificity, authority, social proof, contrast, future pacing, identity, community, and relevance when grounded in data.",
        "- Use scarcity or urgency only when true.",
        "- Use pacing and leading, sensory detail, open loops, narrative tension, reader identity, and conversational flow naturally.",
        "- Avoid manipulation.",
        "- If Book DNA contains foreignPraiseQuotes, include every translated quote in the 'Giới thiệu sách' section with source attribution.",
        "- Do not create, paraphrase, or exaggerate praise quotes. Use only foreignPraiseQuotes supplied by Book DNA.",
        "",
        "Publishing-specific rules:",
        "- Literary fiction: emphasize voice, atmosphere, themes, translation, and author reputation when supported.",
        "- Genre fiction: emphasize plot, mystery, stakes, and worldbuilding when supported.",
        "- Nonfiction: emphasize insight, usefulness, authority, and relevance.",
        "- Children's books: emphasize emotion, reading experience, and parent-child value.",
        "- For children's books, separate Reader DNA (child) from Buyer DNA (parent/adult), and write from reading together, playing, interaction, curiosity, expression, and participation.",
        "- Politics, economics, history: emphasize expertise, context, timeliness, and evidence.",
        "- Combo products: emphasize the real buying logic: complete set, same author/series/theme, or convenience, only when supported.",
        "- Technical specs such as page count, size, binding, format, price, ISBN, and publisher only belong in final publication information.",
        "- Never use page count, book size, or paperback binding as a selling point.",
        "",
        "Additional hard rules:",
        "- Never fabricate awards, reviews, bestseller status, sales numbers, endorsements, or media coverage.",
        "- Avoid overusing: \"khong chi... ma con\", \"mang den cho doc gia\", \"hanh trinh day cam xuc\", \"sieu pham\", \"gay bao\", \"khong the bo lo\", \"noi ma\".",
        "- Every paragraph must give the reader a real reason to keep reading or understand why this book matters.",
        "- Prefer intelligent simplicity over marketing noise.",
        "",
        "Final quality check before returning JSON:",
        "- Is there a real reason to read or consider this book?",
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
        "- Không thay đổi tên sách hoặc tác giả.",
        "- Nếu Book DNA confidence < 50, phải viết thận trọng, ngắn hơn, và cảnh báo thiếu dữ liệu.",
        "- Nếu Book DNA có forbiddenClaims, tuyệt đối tránh các claim đó.",
        "- Không dùng giọng quảng cáo quá đà.",
        "- Không dùng các cụm sáo: \"không chỉ... mà còn\", \"điều thú vị là\", \"hành trình khám phá\", \"mở ra cánh cửa\", \"đắm chìm\", \"cuốn sách không thể bỏ qua\".",
        "- Không dùng filler: \"bìa mềm dễ cầm đọc\", \"thuận tiện bổ sung vào tủ sách\", \"phù hợp làm quà tặng\", \"số trang phù hợp để đọc lâu hơn\", \"khổ sách dễ mang theo\".",
        "- Không biến thông tin kỹ thuật thành điểm bán hàng chính.",
        "- Không viết CTA dưới bất kỳ hình thức nào.",
        "- Không viết: \"Hợp nếu bạn đang tìm...\", \"Nếu bạn cần...\", \"Lựa chọn đáng cân nhắc\", \"Xem chi tiết ngay trên trang sách\".",
        "- Không dùng các cụm phân tích lộ AI: \"Điểm khiến...\", \"Điểm hấp dẫn...\", \"Điểm nổi bật...\", \"Giá trị của...\", \"Đây là một lựa chọn...\".",
        "- Không claim giá trị sưu tầm nếu dữ liệu không chứng minh rõ người mua coi sản phẩm là đồ sưu tầm.",
        "- Không viết giá bán, ISBN, mã sản phẩm, SKU, ngày phát hành hoặc năm phát hành trong phần AI.",
        "- Không tự viết phần Thông tin xuất bản. Code sẽ tự render phần này từ metadata Sapo.",
        "- Nếu Book DNA có foreignPraiseQuotes, phải đưa toàn bộ lời khen đã dịch vào phần Giới thiệu sách, có ghi nguồn.",
        "",
        "Cấu trúc HTML AI được phép viết:",
        "- h2 Giới thiệu sách",
        "- h2 Cuốn sách này dành cho ai",
        "- Không tạo thêm section nào khác.",
        "- Không tạo CTA.",
        "- Không tạo Thông tin xuất bản.",
        "- Code sẽ tự append h2 Thông tin xuất bản ở cuối từ metadata Sapo.",
        "",
        "Chỉ dùng thẻ:",
        "p, h2, strong, em, ul, li",
        "",
        "Không dùng:",
        "markdown, inline style, img, iframe, script",
        "",
        "Output JSON:",
        JSON.stringify({
          seoTitle: "",
          metaDescription: "",
          productDescriptionHtml: "<h2>Giới thiệu sách</h2><p>...</p>",
          marketingBlocksHtml: "<h2>Cuốn sách này dành cho ai</h2><ul><li>...</li></ul>",
          finalBodyHtml: "Leave empty. Code will compose finalBodyHtml.",
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

  return normalizeAiResult(result, input);
}

function ensureBookUnderstandingReady(input: ProductSeoMarketingInput): void {
  const requiredFields = [
    ["readerDNA", input.bookDNA.readerDNA],
    ["buyerDNA", input.bookDNA.buyerDNA],
    ["readingExperience", input.bookDNA.readingExperience],
    ["corePromise", input.bookDNA.corePromise],
    ["competitiveAdvantage", input.bookDNA.competitiveAdvantage],
    ["positioningStatement", input.bookDNA.positioningStatement],
    ["selectedFramework", input.bookDNA.selectedFramework]
  ];
  const missingFields = requiredFields.filter(([, value]) => typeof value !== "string" || !value.trim()).map(([field]) => field);

  if (missingFields.length > 0) {
    throw new AppError(`Book Understanding chưa đủ để viết: ${missingFields.join(", ")}`, "BOOK_UNDERSTANDING_INCOMPLETE");
  }

  // Weak positioning should make the writer cautious, not block the flow.
  // Final HTML validation still rejects filler and unsafe generic claims.
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

function normalizeAiResult(result: RawAiProductSeoResult, input: ProductSeoMarketingInput): ProductSeoMarketingResult {
  const seoTitle = readRequiredString(result.seoTitle, "seoTitle").slice(0, 70);
  const metaDescription = readRequiredString(result.metaDescription, "metaDescription").slice(0, 170);
  const productDescriptionHtml = validateHtml(
    sanitizeProductDescriptionHtml(readRequiredString(result.productDescriptionHtml, "productDescriptionHtml")),
    "productDescriptionHtml",
    { aiContent: true, minTextLength: MIN_BLOCK_TEXT_LENGTH }
  );
  validateSingleHeading(productDescriptionHtml, "gioi thieu sach", "productDescriptionHtml");
  validateForeignPraiseIncluded(productDescriptionHtml, input.bookDNA.foreignPraiseQuotes ?? []);

  const marketingBlocksHtml = validateHtml(
    sanitizeProductDescriptionHtml(readRequiredString(result.marketingBlocksHtml, "marketingBlocksHtml")),
    "marketingBlocksHtml",
    { aiContent: true, minTextLength: MIN_BLOCK_TEXT_LENGTH }
  );
  validateSingleHeading(marketingBlocksHtml, "cuon sach nay danh cho ai", "marketingBlocksHtml");

  const finalBodyHtml = validateHtml(buildFinalBodyHtml(input.product, productDescriptionHtml, marketingBlocksHtml), "finalBodyHtml");
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
      ...(input.bookDNA.confidence < 50
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

function buildFinalBodyHtml(product: NormalizedSapoProduct, introductionHtml: string, audienceHtml: string): string {
  return [
    introductionHtml.trim(),
    audienceHtml.trim(),
    buildPublicationInfoHtml(product)
  ]
    .filter(Boolean)
    .join("\n");
}

function buildPublicationInfoHtml(product: NormalizedSapoProduct): string {
  const raw = isRecord(product.raw) ? product.raw : {};
  const fields: Array<[string, string | undefined]> = [
    ["Tác giả", readProductMetadata(raw, ["author", "authors", "author_name", "tac_gia", "tacgia", "tác giả"])],
    ["Dịch giả", readProductMetadata(raw, ["translator", "translators", "translated_by", "dich_gia", "dichgia", "dịch giả"])],
    [
      "Nhà xuất bản",
      readProductMetadata(raw, [
        "publisher",
        "publishers",
        "publishing_house",
        "nxb",
        "nha_xuat_ban",
        "nhà xuất bản"
      ])
    ],
    ["Số trang", readProductMetadata(raw, ["pages", "page_count", "number_of_pages", "so_trang", "số trang"])],
    ["Kích thước", readProductMetadata(raw, ["size", "dimensions", "book_size", "kich_thuoc", "kích thước"])]
  ].filter((field): field is [string, string] => typeof field[1] === "string" && field[1].trim().length > 0);

  const rows = fields.map(([label, value]) => `<p><strong>${escapeHtml(label)}:</strong> ${escapeHtml(String(value))}</p>`);
  return ["<h2>Thông tin xuất bản</h2>", ...rows].join("\n");
}

function readProductMetadata(raw: Record<string, unknown>, keyAliases: string[]): string | undefined {
  const direct = findMetadataValue(raw, keyAliases, 0);
  if (direct) {
    return direct;
  }

  return undefined;
}

function findMetadataValue(value: unknown, keyAliases: string[], depth: number): string | undefined {
  if (depth > 5 || value == null) {
    return undefined;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findMetadataValue(item, keyAliases, depth + 1);
      if (found) {
        return found;
      }
    }
    return undefined;
  }

  if (!isRecord(value)) {
    return undefined;
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    if (isMetadataKeyMatch(key, keyAliases)) {
      const rendered = renderMetadataValue(nestedValue);
      if (rendered) {
        return rendered;
      }
    }
  }

  for (const nestedValue of Object.values(value)) {
    const found = findMetadataValue(nestedValue, keyAliases, depth + 1);
    if (found) {
      return found;
    }
  }

  return undefined;
}

function isMetadataKeyMatch(key: string, aliases: string[]): boolean {
  const normalizedKey = normalizeForQualityCheck(key).replace(/[^a-z0-9]+/g, "");
  return aliases.some((alias) => normalizedKey === normalizeForQualityCheck(alias).replace(/[^a-z0-9]+/g, ""));
}

function renderMetadataValue(value: unknown): string | undefined {
  if (typeof value === "string" || typeof value === "number") {
    const rendered = String(value).trim();
    return rendered || undefined;
  }

  if (Array.isArray(value)) {
    const rendered = value
      .map((item) => renderMetadataValue(item))
      .filter(Boolean)
      .join(", ");
    return rendered || undefined;
  }

  if (isRecord(value)) {
    for (const key of ["value", "name", "title", "label"]) {
      const rendered = renderMetadataValue(value[key]);
      if (rendered) {
        return rendered;
      }
    }
  }

  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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

function validateHtml(
  html: string,
  fieldName: string,
  options: { aiContent?: boolean; minTextLength?: number } = {}
): string {
  const plainText = stripHtml(html);
  const minTextLength = options.minTextLength ?? MIN_FINAL_TEXT_LENGTH;
  if (!plainText || plainText.length < minTextLength) {
    throw new AppError(`HTML sau sanitize rỗng hoặc quá ngắn: ${fieldName}`, "AI_PRODUCT_SEO_HTML_TOO_SHORT");
  }

  if (/<script|<iframe|<img|style=/i.test(html)) {
    throw new AppError(`HTML sau sanitize còn chứa tag/attribute không hợp lệ: ${fieldName}`, "AI_PRODUCT_SEO_UNSAFE_HTML");
  }

  if (FORBIDDEN_FILLER_PATTERNS.some((pattern) => pattern.test(plainText))) {
    throw new AppError(`HTML sau sanitize còn chứa filler bị cấm: ${fieldName}`, "AI_PRODUCT_SEO_FORBIDDEN_FILLER");
  }

  const normalizedText = normalizeForQualityCheck(plainText);
  if (FORBIDDEN_NORMALIZED_PHRASES.some((phrase) => normalizedText.includes(phrase))) {
    throw new AppError(`HTML sau sanitize con chua cum SEO/filler bi cam: ${fieldName}`, "AI_PRODUCT_SEO_FORBIDDEN_FILLER");
  }

  if (options.aiContent) {
    if (normalizedText.includes("thong tin xuat ban")) {
      throw new AppError(`AI không được tự viết block Thông tin xuất bản: ${fieldName}`, "AI_PRODUCT_SEO_FORBIDDEN_STRUCTURE");
    }

    if (FORBIDDEN_AI_CONTENT_PATTERNS.some((pattern) => pattern.test(plainText))) {
      throw new AppError(`AI content còn chứa thông tin kỹ thuật bị cấm: ${fieldName}`, "AI_PRODUCT_SEO_FORBIDDEN_METADATA");
    }
  }

  return html;
}

function validateSingleHeading(html: string, normalizedHeading: string, fieldName: string): void {
  const headings = Array.from(html.matchAll(/<h2>([\s\S]*?)<\/h2>/gi)).map((match) =>
    normalizeForQualityCheck(stripHtml(match[1]))
  );

  if (headings.length !== 1 || headings[0] !== normalizedHeading || /<h3>/i.test(html)) {
    throw new AppError(`AI sai cấu trúc heading bắt buộc: ${fieldName}`, "AI_PRODUCT_SEO_INVALID_STRUCTURE");
  }
}

function validateForeignPraiseIncluded(html: string, foreignPraiseQuotes: string[]): void {
  if (foreignPraiseQuotes.length === 0) {
    return;
  }

  const compactHtml = compactForQualityCheck(stripHtml(html));
  const missingQuote = foreignPraiseQuotes.find((quote) => {
    const compactQuote = compactForQualityCheck(quote);
    return compactQuote.length > 0 && !compactHtml.includes(compactQuote);
  });

  if (missingQuote) {
    throw new AppError(
      "AI chưa đưa đầy đủ lời khen báo nước ngoài đã dịch vào phần Giới thiệu sách",
      "AI_PRODUCT_SEO_MISSING_FOREIGN_PRAISE"
    );
  }
}

function normalizeForQualityCheck(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u0111/g, "d")
    .replace(/\u0110/g, "D")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function compactForQualityCheck(text: string): string {
  return normalizeForQualityCheck(text).replace(/[^a-z0-9]+/g, "");
}
