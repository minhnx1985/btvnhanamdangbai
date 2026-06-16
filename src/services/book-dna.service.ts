import axios from "axios";
import { BookDNA, NormalizedSapoProduct } from "../types/product-seo.types";
import { AppError } from "../utils/errors";
import { logger } from "../utils/logger";
import { getBookDnaMarketingStrategyPrompt } from "./book-dna-marketing-strategy.service";
import { shopApiService, ShopApiChatMessage } from "./shopapi.service";

type BookDNAInput = {
  product: NormalizedSapoProduct;
  relatedData?: {
    currentContentText?: string;
    summaryText?: string;
    tags?: string[];
    categories?: string[];
    sameAuthorProducts?: Array<{
      title: string;
      alias?: string;
      summary?: string;
    }>;
  };
};

type RawBookDNA = Partial<Record<keyof BookDNA, unknown>>;

type HumanEnrichmentInput = {
  product: NormalizedSapoProduct;
  currentBookDNA: BookDNA;
  enrichmentText: string;
};

type RawHumanBookEnrichment = {
  dataType?: unknown;
  summary?: unknown;
  insights?: unknown;
  updatedBookDNA?: RawBookDNA;
};

export async function analyzeBookDNA(input: BookDNAInput): Promise<BookDNA> {
  logger.info("book_dna_started", {
    productId: input.product.id,
    alias: input.product.alias ?? input.product.handle
  });

  const result = await generateBookDNAJson([
    {
      role: "system",
      content: [
        "Mandatory flow before writing:",
        "Product Data -> Book Understanding -> Positioning -> Framework Selection -> Writing.",
        "This step must complete Book Understanding, Positioning, and Framework Selection only. Do not write product description in this step.",
        "",
        getBookDnaMarketingStrategyPrompt(),
        "",
        "Required understanding fields:",
        "- Reader DNA: who actually reads or experiences the book.",
        "- Buyer DNA: who pays or decides to buy.",
        "- Reading Experience: what reading, playing, interacting, or thinking with the book feels like in practice.",
        "- Core Promise: the largest reader/buyer value.",
        "- Competitive Advantage: why choose this book instead of another.",
        "- Positioning Statement: one exact sentence describing what this book is.",
        "- Selected Framework: the most suitable marketing structure, chosen naturally, not forced.",
        "- Foreign Praise Quotes: translated Vietnamese versions of supported praise from foreign newspapers, magazines, publishers, or reputable media sources.",
        "",
        "Rules:",
        "- Do not start from metadata. Metadata can support understanding, but it is not the angle.",
        "- Do not use page count, book size, paperback binding, or technical specs as selling points.",
        "- Technical specs belong only to final publication information, never to core positioning.",
        "- If you cannot create a precise Positioning Statement, reduce confidence and list missingData.",
        "- For children's books, prioritize parent-child value and distinguish Reader (child) from Buyer (parent/adult).",
        "- For interactive children's books, analyze reading together, playing, sound, facial expression, movement, curiosity, and participation.",
        "",
        "Bạn là chuyên gia marketing sách và biên tập nội dung cho Nhã Nam.",
        "",
        "Nhiệm vụ:",
        "Phân tích DNA của một cuốn sách trước khi viết mô tả sản phẩm.",
        "",
        "Bạn KHÔNG được viết mô tả sản phẩm ở bước này.",
        "Bạn chỉ được phân tích.",
        "",
        "Dữ liệu đầu vào gồm:",
        "- thông tin sản phẩm từ Sapo",
        "- mô tả hiện có nếu có",
        "- summary nếu có",
        "- tags/category nếu có",
        "- sách cùng tác giả nếu có",
        "",
        "Hãy xác định:",
        "1. Đây là loại sách gì?",
        "2. Sức hút chính của cuốn sách nằm ở đâu?",
        "3. Độc giả nào có khả năng mua?",
        "4. Họ mua vì lý do gì?",
        "5. Có lợi thế tác giả/series/tủ sách nào không?",
        "6. Nên dùng angle marketing nào?",
        "7. Nên tránh nói gì vì thiếu dữ liệu?",
        "8. Những dữ liệu nào còn thiếu?",
        "",
        "Quy tắc:",
        "- Không bịa cốt truyện, giải thưởng, độ tuổi, review, so sánh nếu không có dữ liệu.",
        "- Không biến thông số kỹ thuật như số trang, khổ sách, bìa mềm thành điểm bán hàng nếu không thật sự có ý nghĩa.",
        "- Nếu chỉ có metadata nghèo, phải giảm confidence và ghi rõ missingData.",
        "- Với sách của tác giả nổi tiếng, phải ưu tiên phân tích author leverage.",
        "- Với sách thiếu nhi, phải phân tích cả người đọc trực tiếp và người mua thực tế, thường là phụ huynh.",
        "- Với sách kinh điển, phải phân tích vị thế văn học/tư tưởng nếu có căn cứ.",
        "- Với sách hoạt động/tô màu, phải phân tích lợi ích thao tác, quan sát, tập trung, sáng tạo nếu dữ liệu cho phép.",
        "- Với combo, phải phân tích logic mua combo: trọn bộ, cùng tác giả/series/chủ đề, tiện mua một lần.",
        "",
        "Output bắt buộc là JSON hợp lệ:",
        JSON.stringify({
          bookType: "",
          genreOrCategory: "",
          readerDNA: "",
          buyerDNA: "",
          readingExperience: "",
          corePromise: "",
          competitiveAdvantage: "",
          positioningStatement: "",
          selectedFramework: "",
          corePremise: "",
          coreAppeal: "",
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
          marketingAngle: "",
          seoKeywords: [],
          forbiddenClaims: [],
          missingData: [],
          confidence: 0
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
        relatedData: input.relatedData ?? {}
      })
    }
  ]);

  const bookDNA = normalizeBookDNA(result);
  logger.info("book_dna_completed", {
    productId: input.product.id,
    alias: input.product.alias ?? input.product.handle,
    confidence: bookDNA.confidence
  });
  return bookDNA;
}

export async function enrichBookDNA(input: HumanEnrichmentInput): Promise<{
  dataType: string;
  summary: string;
  insights: string[];
  updatedBookDNA: BookDNA;
}> {
  const enrichmentSource = await prepareHumanEnrichmentSource(input.enrichmentText);

  const result = await generateHumanEnrichmentJson([
    {
      role: "system",
      content: [
        "You are a senior Vietnamese publishing marketer and copy strategist working for Nha Nam.",
        "",
        "Task:",
        "A human user is teaching the bot more about a book before product-page writing.",
        "Read the new data, detect the data type, summarize it, extract useful marketing/editorial insights, then update Book DNA.",
        "",
        "Mandatory flow:",
        "Book DNA -> Human Enrichment -> Final Book Understanding -> Writing.",
        "This step is Human Enrichment and Final Book Understanding only. Do not write product description.",
        "",
        getBookDnaMarketingStrategyPrompt(),
        "",
        "Possible data types:",
        "- plain note",
        "- website link",
        "- Nha Nam link",
        "- Wikipedia link",
        "- press/article link",
        "- back cover",
        "- review",
        "- editor note",
        "- mixed source",
        "",
        "Rules:",
        "- Do not fabricate awards, reviews, bestseller status, sales numbers, endorsements, media coverage, plot details, or age claims.",
        "- Update only what is supported by product data, existing Book DNA, or the new human data.",
        "- Separate Reader DNA from Buyer DNA.",
        "- For children's books, prioritize parent-child value, reading together, play, interaction, curiosity, expression, and participation.",
        "- Do not use page count, book size, paperback binding, or other technical specs as selling points.",
        "- If the new data includes praise from foreign newspapers, magazines, publishers, or reputable media sources, translate every supported praise quote fully into Vietnamese and store it in updatedBookDNA.foreignPraiseQuotes with source attribution.",
        "- Preserve the meaning of foreign praise; do not summarize it so much that the quote loses substance.",
        "- Do not invent praise, source names, reviews, or media coverage. If source attribution is unclear, say so inside the quote entry.",
        "- If the new data is weak or only a URL with little readable content, keep confidence modest and list missingData.",
        "- If Positioning Statement cannot be precise, lower confidence and explain missingData.",
        "",
        "Output JSON only:",
        JSON.stringify({
          dataType: "",
          summary: "",
          insights: [],
          updatedBookDNA: {
            bookType: "",
            genreOrCategory: "",
            readerDNA: "",
            buyerDNA: "",
            readingExperience: "",
            corePromise: "",
            competitiveAdvantage: "",
            positioningStatement: "",
            selectedFramework: "",
            corePremise: "",
            coreAppeal: "",
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
            marketingAngle: "",
            seoKeywords: [],
            forbiddenClaims: [],
            missingData: [],
            confidence: 0
          }
        }),
        "",
        "No markdown, no explanation outside JSON."
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
          variants: input.product.variants
        },
        currentBookDNA: input.currentBookDNA,
        humanEnrichment: enrichmentSource
      })
    }
  ]);

  if (!result.updatedBookDNA) {
    throw new AppError("Human Enrichment thieu updatedBookDNA", "BOOK_DNA_INVALID_RESPONSE");
  }

  return {
    dataType: readString(result.dataType, "dataType"),
    summary: readString(result.summary, "summary"),
    insights: readStringArray(result.insights, "insights"),
    updatedBookDNA: normalizeBookDNA(result.updatedBookDNA)
  };
}

function normalizeForQualityCheck(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .replace(/\u0111/g, "d")
    .replace(/\u0110/g, "D")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

async function prepareHumanEnrichmentSource(rawText: string): Promise<{
  originalText: string;
  detectedUrls: string[];
  fetchedText?: string;
}> {
  const text = rawText.trim();
  const detectedUrls = Array.from(text.matchAll(/https?:\/\/[^\s]+/gi)).map((match) => match[0]);
  const firstUrl = detectedUrls[0];

  if (!firstUrl) {
    return { originalText: text, detectedUrls };
  }

  const fetchedText = await fetchReadableUrlText(firstUrl);
  return {
    originalText: text,
    detectedUrls,
    fetchedText
  };
}

async function fetchReadableUrlText(url: string): Promise<string | undefined> {
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return undefined;
    }

    const response = await axios.get<string>(parsed.toString(), {
      responseType: "text",
      timeout: 10000,
      maxContentLength: 800000,
      headers: {
        "User-Agent": "NhaNamSeoBot/1.0"
      }
    });

    return stripHtmlToReadableText(String(response.data)).slice(0, 12000);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Unknown URL fetch error";
    logger.warn("book_dna_enrichment_url_fetch_failed", { url, reason });
    return undefined;
  }
}

function stripHtmlToReadableText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

async function generateHumanEnrichmentJson(messages: ShopApiChatMessage[]): Promise<RawHumanBookEnrichment> {
  try {
    return await shopApiService.generateJson<RawHumanBookEnrichment>(messages);
  } catch (error) {
    if (error instanceof AppError && error.code === "AI_JSON_PARSE_FAILED") {
      throw new AppError("Human Enrichment JSON parse fail", "BOOK_DNA_ENRICHMENT_JSON_PARSE_FAILED");
    }

    throw error;
  }
}

async function generateBookDNAJson(messages: ShopApiChatMessage[]): Promise<RawBookDNA> {
  try {
    return await shopApiService.generateJson<RawBookDNA>(messages);
  } catch (error) {
    if (error instanceof AppError && error.code === "AI_JSON_PARSE_FAILED") {
      throw new AppError("Book DNA JSON parse fail", "BOOK_DNA_JSON_PARSE_FAILED");
    }

    throw error;
  }
}

function normalizeBookDNA(result: RawBookDNA): BookDNA {
  const positioningStatement = readPositioningStatement(result.positioningStatement);

  return {
    bookType: readString(result.bookType, "bookType"),
    genreOrCategory: readString(result.genreOrCategory, "genreOrCategory"),
    readerDNA: readString(result.readerDNA, "readerDNA"),
    buyerDNA: readString(result.buyerDNA, "buyerDNA"),
    readingExperience: readString(result.readingExperience, "readingExperience"),
    corePromise: readString(result.corePromise, "corePromise"),
    competitiveAdvantage: readString(result.competitiveAdvantage, "competitiveAdvantage"),
    positioningStatement,
    selectedFramework: readString(result.selectedFramework, "selectedFramework"),
    corePremise: readString(result.corePremise, "corePremise"),
    coreAppeal: readString(result.coreAppeal, "coreAppeal"),
    emotionalPromise: readString(result.emotionalPromise, "emotionalPromise"),
    intellectualPromise: readString(result.intellectualPromise, "intellectualPromise"),
    targetReaders: readStringArray(result.targetReaders, "targetReaders"),
    buyingReasons: readStringArray(result.buyingReasons, "buyingReasons"),
    sellingPoints: readStringArray(result.sellingPoints, "sellingPoints"),
    authorLeverage: readString(result.authorLeverage, "authorLeverage"),
    seriesOrBrandLeverage: readString(result.seriesOrBrandLeverage, "seriesOrBrandLeverage"),
    comparableTitlesOrSignals: readStringArray(result.comparableTitlesOrSignals, "comparableTitlesOrSignals"),
    foreignPraiseQuotes: readOptionalStringArray(result.foreignPraiseQuotes, "foreignPraiseQuotes"),
    toneOfVoice: readString(result.toneOfVoice, "toneOfVoice"),
    marketingAngle: readString(result.marketingAngle, "marketingAngle"),
    seoKeywords: readStringArray(result.seoKeywords, "seoKeywords"),
    forbiddenClaims: readStringArray(result.forbiddenClaims, "forbiddenClaims"),
    missingData: readStringArray(result.missingData, "missingData"),
    confidence: readConfidence(result.confidence)
  };
}

function readString(value: unknown, fieldName: string): string {
  if (typeof value !== "string") {
    throw new AppError(`Book DNA thiếu field bắt buộc: ${fieldName}`, "BOOK_DNA_INVALID_RESPONSE");
  }

  return value.trim();
}

function readPositioningStatement(value: unknown): string {
  const statement = readString(value, "positioningStatement");
  return statement;
}

function readStringArray(value: unknown, fieldName: string): string[] {
  if (!Array.isArray(value)) {
    throw new AppError(`Book DNA field không hợp lệ: ${fieldName}`, "BOOK_DNA_INVALID_RESPONSE");
  }

  return value.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean);
}

function readOptionalStringArray(value: unknown, fieldName: string): string[] {
  if (typeof value === "undefined") {
    return [];
  }

  return readStringArray(value, fieldName);
}

function readConfidence(value: unknown): number {
  const numberValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numberValue)) {
    throw new AppError("Book DNA confidence không hợp lệ", "BOOK_DNA_INVALID_RESPONSE");
  }

  return Math.max(0, Math.min(100, Math.round(numberValue)));
}
