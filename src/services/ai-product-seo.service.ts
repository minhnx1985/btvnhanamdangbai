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

const PROCESS_LANGUAGE_PATTERNS = [
  /^Theo\s+(?:mô tả sản phẩm|dữ liệu sản phẩm|Book DNA|phân tích Book DNA|thông tin hiện có)[\s\S]*?[.!?。]?$/i,
  /^Book DNA\s+(?:hiện|chưa|không|đang)[\s\S]*?[.!?。]?$/i,
  /^Dữ liệu\s+(?:hiện có|sản phẩm|Book DNA)[\s\S]*?[.!?。]?$/i,
  /^Mô tả này\s+(?:chỉ|được|tập trung|dựa)[\s\S]*?[.!?。]?$/i,
  /^Nguồn:\s*[\s\S]*$/i,
  /^\(Nguồn:\s*[\s\S]*?\)$/i,
  /\(Nguồn:\s*mô tả sản phẩm\)/i,
  /\btheo mô tả sản phẩm\b/i,
  /\btheo dữ liệu sản phẩm\b/i,
  /\bBook DNA hiện\b/i,
  /\bmô tả này chỉ tập trung\b/i
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

  const messages: ShopApiChatMessage[] = [
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
        "- Không nhắc tới nguồn nội bộ/quy trình như: \"Theo mô tả sản phẩm\", \"Theo dữ liệu sản phẩm\", \"Nguồn: mô tả sản phẩm\", \"Book DNA hiện...\", \"mô tả này chỉ tập trung...\".",
        "- Viết như nội dung xuất bản sạch trên website, không giải thích rằng mình đang thiếu dữ liệu hoặc đang dựa vào Book DNA.",
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
          seoTitle: input.product.seoTitle ?? input.product.metaTitle,
          metaDescription: input.product.metaDescription ?? input.product.seoDescription
        },
        audit: input.audit,
        bookDNA: input.bookDNA
      })
    }
  ];

  const result = await generateWriterJson(messages);
  try {
    return normalizeAiResult(result, input);
  } catch (error) {
    if (!isRetryableWriterValidationError(error)) {
      throw error;
    }

    const retryResult = await generateWriterJson([
      ...messages,
      {
        role: "user",
        content: [
          "Output trước bị hệ thống từ chối sau sanitize/validation.",
          `Lỗi: ${error instanceof Error ? error.message : String(error)}`,
          "",
          "Hãy viết lại JSON một lần nữa.",
          "Bắt buộc sửa lỗi trên, bỏ hoàn toàn cụm bị cấm, không thêm CTA, không thêm section ngoài cấu trúc.",
          "Giữ đúng hai block AI: h2 Giới thiệu sách và h2 Cuốn sách này dành cho ai.",
          "Không tự viết Thông tin xuất bản.",
          "",
          "Output trước:",
          JSON.stringify(result)
        ].join("\n")
      }
    ]);

    return normalizeAiResult(retryResult, input);
  }
}

export function formatExistingProductDescription(product: NormalizedSapoProduct, sourceText?: string): ProductSeoMarketingResult {
  const hasSubmittedText = typeof sourceText === "string" && sourceText.trim().length > 0;
  const sourceHtml = sanitizeProductDescriptionHtml(hasSubmittedText ? sourceText ?? "" : product.content || product.summary || "");
  const blocks = htmlToTextBlocks(sourceHtml);
  if (blocks.length === 0) {
    throw new AppError(
      hasSubmittedText
        ? "Mô tả bạn gửi chưa có đủ nội dung để format."
        : "Sản phẩm chưa có mô tả hiện có đủ nội dung để format.",
      "PRODUCT_DESCRIPTION_SOURCE_EMPTY"
    );
  }

  const sections = splitExistingDescriptionSections(blocks);
  const productDescriptionHtml = buildTextOnlySectionHtml("Giới thiệu sách", sections.introduction, product.title);
  const marketingBlocksHtml =
    sections.audience.length > 0 ? buildAudienceSectionHtml("Cuốn sách này dành cho ai", sections.audience, product.title) : "";
  const finalBodyHtml = validateHtml(
    buildFinalBodyHtml(product, productDescriptionHtml, marketingBlocksHtml),
    "finalBodyHtml",
    { checkForbiddenFiller: false }
  );
  const plainText = stripHtml(finalBodyHtml);

  return {
    seoTitle: product.title,
    metaDescription: plainText.slice(0, 160),
    productDescriptionHtml,
    marketingBlocksHtml,
    finalBodyHtml,
    telegramPreview: plainText.slice(0, 1200),
    improvedSeoScore: 0,
    improvedMarketingScore: 0,
    warnings: [
      hasSubmittedText
        ? "Format-only: bot chỉ định dạng mô tả người dùng nhập, không sửa câu chữ bằng AI."
        : "Format-only: bot chỉ định dạng lại mô tả hiện có, không sửa câu chữ bằng AI.",
      ...(sections.audience.length === 0
        ? [
            hasSubmittedText
              ? "Không thấy section 'Cuốn sách này dành cho ai' trong mô tả bạn gửi nên bot không tự tạo thêm nội dung này."
              : "Không thấy section 'Cuốn sách này dành cho ai' trong mô tả hiện có nên bot không tự tạo thêm nội dung này."
          ]
        : [])
    ]
  };
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

function isRetryableWriterValidationError(error: unknown): boolean {
  if (!(error instanceof AppError)) {
    return false;
  }

  return [
    "AI_PRODUCT_SEO_FORBIDDEN_FILLER",
    "AI_PRODUCT_SEO_FORBIDDEN_STRUCTURE",
    "AI_PRODUCT_SEO_FORBIDDEN_METADATA",
    "AI_PRODUCT_SEO_INVALID_STRUCTURE",
    "AI_PRODUCT_SEO_MISSING_FOREIGN_PRAISE"
  ].includes(error.code);
}

function normalizeAiResult(result: RawAiProductSeoResult, input: ProductSeoMarketingInput): ProductSeoMarketingResult {
  const validationWarnings: string[] = [];
  const seoTitle = readRequiredString(result.seoTitle, "seoTitle").slice(0, 70);
  const metaDescription = readRequiredString(result.metaDescription, "metaDescription").slice(0, 170);
  let productDescriptionHtml = cleanProcessLanguageHtml(
    sanitizeProductDescriptionHtml(readRequiredString(result.productDescriptionHtml, "productDescriptionHtml")),
    "productDescriptionHtml",
    validationWarnings
  );
  productDescriptionHtml = validateHtml(
    productDescriptionHtml,
    "productDescriptionHtml",
    { aiContent: true, minTextLength: MIN_BLOCK_TEXT_LENGTH, warnings: validationWarnings }
  );
  productDescriptionHtml = keepOnlySectionByHeading(
    productDescriptionHtml,
    "gioi thieu sach",
    "productDescriptionHtml",
    validationWarnings
  );
  productDescriptionHtml = normalizeRequiredSectionHeading(
    productDescriptionHtml,
    "Giới thiệu sách",
    "gioi thieu sach",
    "productDescriptionHtml",
    validationWarnings
  );
  validateForeignPraiseIncluded(productDescriptionHtml, input.bookDNA.foreignPraiseQuotes ?? []);

  let marketingBlocksHtml = cleanProcessLanguageHtml(
    sanitizeProductDescriptionHtml(readRequiredString(result.marketingBlocksHtml, "marketingBlocksHtml")),
    "marketingBlocksHtml",
    validationWarnings
  );
  marketingBlocksHtml = validateHtml(
    marketingBlocksHtml,
    "marketingBlocksHtml",
    { aiContent: true, minTextLength: MIN_BLOCK_TEXT_LENGTH, warnings: validationWarnings }
  );
  marketingBlocksHtml = keepOnlySectionByHeading(
    marketingBlocksHtml,
    "cuon sach nay danh cho ai",
    "marketingBlocksHtml",
    validationWarnings
  );
  marketingBlocksHtml = normalizeRequiredSectionHeading(
    marketingBlocksHtml,
    "Cuốn sách này dành cho ai",
    "cuon sach nay danh cho ai",
    "marketingBlocksHtml",
    validationWarnings
  );

  const finalBodyHtml = validateHtml(buildFinalBodyHtml(input.product, productDescriptionHtml, marketingBlocksHtml), "finalBodyHtml", {
    checkForbiddenFiller: false
  });
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
      ...validationWarnings,
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

function htmlToTextBlocks(html: string): string[] {
  return decodeBasicHtmlEntities(
    html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(?:p|li|h2|h3|ul)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  )
    .split(/\n+/)
    .map((block) => stripMarkdownHeadingMarker(block.replace(/\s+/g, " ").trim()))
    .filter(Boolean);
}

function splitExistingDescriptionSections(blocks: string[]): { introduction: string[]; audience: string[] } {
  const audienceHeadingIndex = blocks.findIndex((block) => {
    const normalized = normalizeSectionHeadingForFormat(block);
    return normalized === "cuon sach nay danh cho ai" || normalized.includes("danh cho ai");
  });
  const publicationHeadingIndex = blocks.findIndex((block) =>
    normalizeSectionHeadingForFormat(block).includes("thong tin xuat ban")
  );
  const endIndex = publicationHeadingIndex >= 0 ? publicationHeadingIndex : blocks.length;

  if (audienceHeadingIndex >= 0 && audienceHeadingIndex < endIndex) {
    return {
      introduction: removeKnownSectionHeadings(blocks.slice(0, audienceHeadingIndex)),
      audience: removeKnownSectionHeadings(blocks.slice(audienceHeadingIndex + 1, endIndex))
    };
  }

  return {
    introduction: removeKnownSectionHeadings(blocks.slice(0, endIndex)),
    audience: []
  };
}

function removeKnownSectionHeadings(blocks: string[]): string[] {
  return blocks.filter((block) => {
    const normalized = normalizeSectionHeadingForFormat(block);
    return (
      normalized !== "gioi thieu sach" &&
      normalized !== "cuon sach nay danh cho ai" &&
      !normalized.includes("thong tin xuat ban")
    );
  });
}

function buildTextOnlySectionHtml(heading: string, blocks: string[], productTitle?: string): string {
  const body = blocks.map((block) => `<p>${formatTextWithBookTitleStrong(block, productTitle)}</p>`).join("\n");
  return [`<h2>${heading}</h2>`, body].filter(Boolean).join("\n");
}

function buildAudienceSectionHtml(heading: string, blocks: string[], productTitle?: string): string {
  const items = blocks
    .flatMap((block) => splitAudienceBlock(block))
    .map((block) => stripListMarker(block))
    .filter(Boolean);

  if (items.length === 0) {
    return "";
  }

  const body = items.map((item) => `<li>${formatTextWithBookTitleStrong(item, productTitle)}</li>`).join("\n");
  return [`<h2>${heading}</h2>`, "<ul>", body, "</ul>"].join("\n");
}

function splitAudienceBlock(block: string): string[] {
  const normalized = block.trim();
  if (!normalized) {
    return [];
  }

  const inlineBulletParts = normalized
    .split(/\s+(?=(?:[-*•–]|[0-9]{1,2}[.)])\s+)/g)
    .map((item) => item.trim())
    .filter(Boolean);

  return inlineBulletParts.length > 1 ? inlineBulletParts : [normalized];
}

function stripListMarker(block: string): string {
  return block.replace(/^\s*(?:[-*•–]|\d{1,2}[.)])\s+/, "").trim();
}

function stripMarkdownHeadingMarker(block: string): string {
  return block.replace(/^\s{0,3}#{1,6}\s+/, "").trim();
}

function normalizeSectionHeadingForFormat(block: string): string {
  return normalizeForQualityCheck(stripMarkdownInlineMarkers(stripMarkdownHeadingMarker(block))).replace(/[:：]+$/g, "").trim();
}

function stripMarkdownInlineMarkers(text: string): string {
  return text.replace(/(\*\*|\*)([^*]+)\1/g, "$2").replace(/(__|_)([^_]+)\1/g, "$2");
}

function formatTextWithBookTitleStrong(text: string, productTitle?: string): string {
  const emphasisPattern = /(\*\*|\*)([^*\n]+?)\1/g;
  let rendered = "";
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = emphasisPattern.exec(text)) !== null) {
    rendered += formatPlainTextWithBookTitleStrong(text.slice(lastIndex, match.index), productTitle);
    rendered += `<strong>${escapeHtml(match[2].trim())}</strong>`;
    lastIndex = match.index + match[0].length;
  }

  rendered += formatPlainTextWithBookTitleStrong(text.slice(lastIndex), productTitle);
  return rendered;
}

function formatPlainTextWithBookTitleStrong(text: string, productTitle?: string): string {
  const title = typeof productTitle === "string" ? productTitle.trim() : "";
  if (!title) {
    return escapeHtml(text);
  }

  const titlePattern = new RegExp(escapeRegExp(title), "gi");
  let rendered = "";
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = titlePattern.exec(text)) !== null) {
    rendered += escapeHtml(text.slice(lastIndex, match.index));
    rendered += `<strong>${escapeHtml(match[0])}</strong>`;
    lastIndex = match.index + match[0].length;

    if (match[0].length === 0) {
      titlePattern.lastIndex += 1;
    }
  }

  rendered += escapeHtml(text.slice(lastIndex));
  return rendered;
}

function decodeBasicHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function buildPublicationInfoHtml(product: NormalizedSapoProduct): string {
  const raw = isRecord(product.raw) ? product.raw : {};
  const fields: Array<[string, string | undefined]> = [
    [
      "Tác giả",
      readProductMetadata(raw, ["author", "authors", "author_name", "tac_gia", "tacgia", "tác giả"], isHumanNameMetadata)
    ],
    [
      "Dịch giả",
      readProductMetadata(
        raw,
        ["translator", "translators", "translated_by", "dich_gia", "dichgia", "dịch giả", "người dịch", "nguoi_dich"],
        isHumanNameMetadata
      )
    ],
    [
      "Nhà xuất bản",
      readProductMetadata(raw, [
        "publisher",
        "publishers",
        "publisher_name",
        "publishing_house",
        "nxb",
        "nha_xuat_ban",
        "nhà xuất bản"
      ], isTextMetadata)
    ],
    [
      "Số trang",
      readProductMetadata(raw, ["pages", "page_count", "number_of_pages", "so_trang", "số trang", "trang"], isPageCountMetadata)
    ],
    [
      "Kích thước",
      readProductMetadata(
        raw,
        ["book_size", "book_dimensions", "product_dimensions", "kich_thuoc", "kích thước", "kho_sach", "khổ sách"],
        isBookSizeMetadata
      )
    ]
  ].filter((field): field is [string, string] => typeof field[1] === "string" && field[1].trim().length > 0);

  if (fields.length === 0) {
    return "";
  }

  const rows = fields.map(([label, value]) => `<p><strong>${escapeHtml(label)}:</strong> ${escapeHtml(String(value))}</p>`);
  return ["<h2>Thông tin xuất bản</h2>", ...rows].join("\n");
}

function readProductMetadata(
  raw: Record<string, unknown>,
  keyAliases: string[],
  validator: (value: string) => boolean
): string | undefined {
  const direct = findMetadataValue(raw, keyAliases, validator, 0);
  if (direct) {
    return direct;
  }

  return undefined;
}

function findMetadataValue(
  value: unknown,
  keyAliases: string[],
  validator: (value: string) => boolean,
  depth: number
): string | undefined {
  if (depth > 5 || value == null) {
    return undefined;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findMetadataValue(item, keyAliases, validator, depth + 1);
      if (found) {
        return found;
      }
    }
    return undefined;
  }

  if (!isRecord(value)) {
    return undefined;
  }

  const labeledValue = readLabeledMetadataObject(value, keyAliases, validator);
  if (labeledValue) {
    return labeledValue;
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    if (isMetadataKeyMatch(key, keyAliases)) {
      const rendered = renderMetadataValue(nestedValue);
      if (rendered && validator(rendered)) {
        return rendered;
      }
    }
  }

  for (const nestedValue of Object.values(value)) {
    const found = findMetadataValue(nestedValue, keyAliases, validator, depth + 1);
    if (found) {
      return found;
    }
  }

  return undefined;
}

function readLabeledMetadataObject(
  value: Record<string, unknown>,
  keyAliases: string[],
  validator: (value: string) => boolean
): string | undefined {
  const label = firstRenderedMetadataValue(value, ["key", "name", "label", "title", "field", "attribute", "attribute_name", "code"]);
  if (!label || !isMetadataKeyMatch(label, keyAliases)) {
    return undefined;
  }

  const rendered = firstRenderedMetadataValue(value, ["value", "display_value", "content", "text"]);
  return rendered && validator(rendered) ? rendered : undefined;
}

function firstRenderedMetadataValue(value: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const rendered = renderMetadataValue(value[key]);
    if (rendered) {
      return rendered;
    }
  }

  return undefined;
}

function isMetadataKeyMatch(key: string, aliases: string[]): boolean {
  const normalizedKey = normalizeForQualityCheck(key).replace(/[^a-z0-9]+/g, "");
  return aliases.some((alias) => normalizedKey === normalizeForQualityCheck(alias).replace(/[^a-z0-9]+/g, ""));
}

function isTextMetadata(value: string): boolean {
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= 120 && !/^\d+$/.test(normalized);
}

function isHumanNameMetadata(value: string): boolean {
  return isTextMetadata(value) && !/@|https?:\/\//i.test(value);
}

function isPageCountMetadata(value: string): boolean {
  const normalized = value.trim();
  const match = normalized.match(/\d{1,4}/);
  if (!match) {
    return false;
  }

  const numberValue = Number(match[0]);
  return numberValue > 0 && numberValue <= 3000;
}

function isBookSizeMetadata(value: string): boolean {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > 80 || /^\d{5,}$/.test(normalized)) {
    return false;
  }

  return /\d+\s*(?:x|×)\s*\d+|\d+\s*(?:cm|mm)/i.test(normalized);
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

function cleanProcessLanguageHtml(html: string, fieldName: string, warnings: string[]): string {
  let removedCount = 0;
  let cleaned = html.replace(/<(p|li)>([\s\S]*?)<\/\1>/gi, (fullMatch, tagName: string, innerHtml: string) => {
    const cleanedInnerHtml = removeInlineProcessLanguage(innerHtml).trim();
    const plainText = stripHtml(cleanedInnerHtml);

    if (!plainText || hasProcessLanguage(plainText)) {
      removedCount += 1;
      return "";
    }

    return `<${tagName.toLowerCase()}>${cleanedInnerHtml}</${tagName.toLowerCase()}>`;
  });

  cleaned = removeInlineProcessLanguage(cleaned);

  if (removedCount > 0 || cleaned !== html) {
    warnings.push(`Bot đã xóa ${removedCount || "một số"} câu/ghi chú quy trình khỏi ${fieldName}.`);
  }

  return cleaned;
}

function removeInlineProcessLanguage(html: string): string {
  return html
    .replace(/\s*\(Nguồn:\s*mô tả sản phẩm\)\s*/gi, " ")
    .replace(/\s*\(Nguồn:\s*Book DNA\)\s*/gi, " ")
    .replace(/\s*\(Nguồn:\s*dữ liệu sản phẩm\)\s*/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasProcessLanguage(text: string): boolean {
  const normalized = text.trim();
  return PROCESS_LANGUAGE_PATTERNS.some((pattern) => pattern.test(normalized));
}

function validateHtml(
  html: string,
  fieldName: string,
  options: { aiContent?: boolean; minTextLength?: number; warnings?: string[]; checkForbiddenFiller?: boolean } = {}
): string {
  const plainText = stripHtml(html);
  const minTextLength = options.minTextLength ?? MIN_FINAL_TEXT_LENGTH;
  if (!plainText || plainText.length < minTextLength) {
    throw new AppError(`HTML sau sanitize rỗng hoặc quá ngắn: ${fieldName}`, "AI_PRODUCT_SEO_HTML_TOO_SHORT");
  }

  if (/<script|<iframe|<img|style=/i.test(html)) {
    throw new AppError(`HTML sau sanitize còn chứa tag/attribute không hợp lệ: ${fieldName}`, "AI_PRODUCT_SEO_UNSAFE_HTML");
  }

  const normalizedText = normalizeForQualityCheck(plainText);
  if (options.checkForbiddenFiller !== false) {
    const hasForbiddenFillerPattern = FORBIDDEN_FILLER_PATTERNS.some((pattern) => pattern.test(plainText));
    if (hasForbiddenFillerPattern) {
      handleForbiddenFiller(`Bản nháp có filler/cụm sáo bị cấm trong ${fieldName}.`, options.warnings);
    }

    const forbiddenPhrase = findForbiddenNormalizedPhrase(normalizedText);
    if (forbiddenPhrase) {
      handleForbiddenFiller(`Bản nháp có cụm bị cấm "${forbiddenPhrase}" trong ${fieldName}.`, options.warnings);
    }
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

function handleForbiddenFiller(message: string, warnings?: string[]): void {
  if (warnings) {
    warnings.push(message);
    return;
  }

  throw new AppError(message, "AI_PRODUCT_SEO_FORBIDDEN_FILLER");
}

function keepOnlySectionByHeading(html: string, normalizedHeading: string, fieldName: string, warnings: string[]): string {
  const matches = Array.from(html.matchAll(/<h2>([\s\S]*?)<\/h2>/gi));
  if (matches.length === 0) {
    return html;
  }

  const targetIndex = matches.findIndex((match) => normalizeForQualityCheck(stripHtml(match[1])) === normalizedHeading);
  const sectionIndex = targetIndex >= 0 ? targetIndex : 0;
  const start = matches[sectionIndex].index ?? 0;
  const end = matches[sectionIndex + 1]?.index ?? html.length;
  const section = html.slice(start, end).trim();

  if (matches.length > 1 || targetIndex < 0) {
    warnings.push(`AI trả nhiều section trong ${fieldName}; bot đã giữ đúng block cần dùng.`);
  }

  return section || html;
}

function normalizeRequiredSectionHeading(
  html: string,
  requiredHeading: string,
  normalizedHeading: string,
  fieldName: string,
  warnings: string[]
): string {
  const originalHeadings = Array.from(html.matchAll(/<h2>([\s\S]*?)<\/h2>/gi)).map((match) =>
    normalizeForQualityCheck(stripHtml(match[1]))
  );
  const hadH3 = /<h3>/i.test(html);
  let normalizedHtml = html.replace(/<\/?h3>/gi, "");
  let replacedFirstHeading = false;

  normalizedHtml = normalizedHtml.replace(/<h2>([\s\S]*?)<\/h2>/gi, (_match, headingText: string) => {
    if (!replacedFirstHeading) {
      replacedFirstHeading = true;
      return `<h2>${requiredHeading}</h2>`;
    }

    const text = stripHtml(headingText);
    return text ? `<p><strong>${escapeHtml(text)}</strong></p>` : "";
  });

  if (!replacedFirstHeading) {
    normalizedHtml = `<h2>${requiredHeading}</h2>\n${normalizedHtml}`;
  }

  if (originalHeadings.length !== 1 || originalHeadings[0] !== normalizedHeading || hadH3) {
    warnings.push(`AI sai heading ở ${fieldName}; bot đã ép về "${requiredHeading}".`);
  }

  const finalHeadings = Array.from(normalizedHtml.matchAll(/<h2>([\s\S]*?)<\/h2>/gi)).map((match) =>
    normalizeForQualityCheck(stripHtml(match[1]))
  );
  if (finalHeadings.length !== 1 || finalHeadings[0] !== normalizedHeading || /<h3>/i.test(normalizedHtml)) {
    throw new AppError(`AI sai cấu trúc heading bắt buộc: ${fieldName}`, "AI_PRODUCT_SEO_INVALID_STRUCTURE");
  }

  return normalizedHtml;
}

function findForbiddenNormalizedPhrase(normalizedText: string): string | undefined {
  return FORBIDDEN_NORMALIZED_PHRASES.find((phrase) => {
    if (/^[a-z0-9]+$/.test(phrase) && phrase.length <= 4) {
      return new RegExp(`(^|[^a-z0-9])${escapeRegExp(phrase)}($|[^a-z0-9])`).test(normalizedText);
    }

    return normalizedText.includes(phrase);
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
