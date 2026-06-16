import { BookDNA, NormalizedSapoProduct, ProductSeoMarketingAudit } from "../types/product-seo.types";

export type { ProductSeoMarketingAudit } from "../types/product-seo.types";

const FILLER_PATTERNS = [
  /bìa mềm dễ cầm đọc/i,
  /thuận tiện bổ sung vào tủ sách/i,
  /phù hợp làm quà tặng/i,
  /số trang phù hợp để đọc lâu hơn/i,
  /khổ sách dễ mang theo/i,
  /tuyệt phẩm/i,
  /hay nhất/i,
  /không thể bỏ qua/i,
  /đỉnh cao/i,
  /số một/i
];

export function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function hasMetaDescriptionLength(product: NormalizedSapoProduct): boolean {
  const metaDescription = product.metaDescription ?? product.seoDescription ?? "";
  return metaDescription.length >= 120 && metaDescription.length <= 160;
}

function hasKeywordSignals(text: string, bookDNA?: BookDNA): boolean {
  const keywords = bookDNA?.seoKeywords ?? [];
  if (keywords.some((keyword) => keyword && text.toLowerCase().includes(keyword.toLowerCase()))) {
    return true;
  }

  return /(sách|tác giả|độc giả|thiếu nhi|văn học|triết học|nghệ thuật|lịch sử|khoa học|giáo dục)/i.test(text);
}

function hasCleanHtml(html: string): boolean {
  return !/<script|<iframe|<img|style=|&nbsp;&nbsp;|\s{4,}/i.test(html);
}

function hasAnyText(source: string, needles: string[]): boolean {
  const lowerSource = source.toLowerCase();
  return needles.some((needle) => needle.trim() && lowerSource.includes(needle.trim().toLowerCase()));
}

function hasFiller(text: string): boolean {
  return FILLER_PATTERNS.some((pattern) => pattern.test(text));
}

export function auditProductSeoMarketing(product: NormalizedSapoProduct, bookDNA?: BookDNA): ProductSeoMarketingAudit {
  const html = product.content ?? "";
  const plainText = stripHtml(html);
  const lowerText = plainText.toLowerCase();
  const issues: string[] = [];
  const opportunities: string[] = [];
  let currentSeoScore = 0;
  let currentMarketingScore = 0;

  if (product.metaTitle || product.seoTitle) {
    currentSeoScore += 15;
  } else {
    issues.push("Chưa thấy meta title rõ ràng.");
  }

  if (hasMetaDescriptionLength(product)) {
    currentSeoScore += 20;
  } else {
    issues.push("Meta description chưa có hoặc chưa đạt độ dài 120-160 ký tự.");
  }

  if (/<h2|<h3/i.test(html)) {
    currentSeoScore += 15;
  } else {
    opportunities.push("Có thể bổ sung H2/H3 để mô tả dễ đọc và tốt hơn cho SEO.");
  }

  if (plainText.includes(product.title)) {
    currentSeoScore += 10;
  } else {
    opportunities.push("Nên nhắc tên sách trong phần mô tả sản phẩm.");
  }

  if (hasKeywordSignals(`${plainText} ${(product.tags ?? []).join(" ")}`, bookDNA)) {
    currentSeoScore += 15;
  } else {
    opportunities.push("Có thể bổ sung keyword liên quan từ Book DNA một cách tự nhiên.");
  }

  if (countWords(plainText) > 180) {
    currentSeoScore += 10;
  } else {
    opportunities.push("Mô tả hiện còn ngắn, cần dữ liệu thật để làm nội dung giàu hơn.");
  }

  if (hasCleanHtml(html)) {
    currentSeoScore += 15;
  } else {
    issues.push("HTML mô tả có dấu hiệu chưa sạch hoặc spacing bất thường.");
  }

  if (bookDNA?.marketingAngle && hasAnyText(plainText, [bookDNA.marketingAngle, bookDNA.coreAppeal])) {
    currentMarketingScore += 20;
  } else {
    opportunities.push("Cần angle marketing rõ, dựa trên Book DNA.");
  }

  if (bookDNA?.sellingPoints?.length && hasAnyText(plainText, bookDNA.sellingPoints)) {
    currentMarketingScore += 20;
  } else {
    opportunities.push("Cần selling points thật, không dùng thông số kỹ thuật làm điểm bán hàng chính.");
  }

  if (bookDNA?.targetReaders?.length && hasAnyText(plainText, bookDNA.targetReaders)) {
    currentMarketingScore += 20;
  } else {
    opportunities.push("Nên làm rõ nhóm độc giả/người mua mục tiêu.");
  }

  const leverageSignals = [bookDNA?.authorLeverage ?? "", bookDNA?.seriesOrBrandLeverage ?? ""].filter(Boolean);
  if (leverageSignals.length === 0 || hasAnyText(plainText, leverageSignals)) {
    currentMarketingScore += 15;
  } else {
    opportunities.push("Có thể tận dụng lợi thế tác giả/series/tủ sách nếu dữ liệu đủ rõ.");
  }

  if (/gợi|quen thuộc|cảm giác|tự nhận ra|bật cười|suy nghĩ|đọc cùng|trò chuyện|quan sát/i.test(lowerText)) {
    currentMarketingScore += 10;
  } else {
    opportunities.push("Có thể mở bằng một quan sát đời thường/góc nhìn biên tập để bài tự nhiên hơn, không cần CTA.");
  }

  if (!hasFiller(plainText)) {
    currentMarketingScore += 15;
  } else {
    issues.push("Mô tả có dấu hiệu filler hoặc quảng cáo rỗng.");
  }

  return {
    currentSeoScore: Math.min(currentSeoScore, 100),
    currentMarketingScore: Math.min(currentMarketingScore, 100),
    issues,
    opportunities
  };
}
