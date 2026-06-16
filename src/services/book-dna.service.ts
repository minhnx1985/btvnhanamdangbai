import { BookDNA, NormalizedSapoProduct } from "../types/product-seo.types";
import { AppError } from "../utils/errors";
import { logger } from "../utils/logger";
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

export async function analyzeBookDNA(input: BookDNAInput): Promise<BookDNA> {
  logger.info("book_dna_started", {
    productId: input.product.id,
    alias: input.product.alias ?? input.product.handle
  });

  const result = await generateBookDNAJson([
    {
      role: "system",
      content: [
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
  return {
    bookType: readString(result.bookType, "bookType"),
    genreOrCategory: readString(result.genreOrCategory, "genreOrCategory"),
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

function readStringArray(value: unknown, fieldName: string): string[] {
  if (!Array.isArray(value)) {
    throw new AppError(`Book DNA field không hợp lệ: ${fieldName}`, "BOOK_DNA_INVALID_RESPONSE");
  }

  return value.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean);
}

function readConfidence(value: unknown): number {
  const numberValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numberValue)) {
    throw new AppError("Book DNA confidence không hợp lệ", "BOOK_DNA_INVALID_RESPONSE");
  }

  return Math.max(0, Math.min(100, Math.round(numberValue)));
}
