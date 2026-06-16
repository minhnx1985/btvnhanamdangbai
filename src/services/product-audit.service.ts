import { NormalizedSapoProduct, ProductSeoMarketingAudit } from "../types/product-seo.types";

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function hasMetaDescriptionLength(product: NormalizedSapoProduct): boolean {
  const metaDescription = product.metaDescription ?? product.seoDescription ?? "";
  return metaDescription.length >= 120 && metaDescription.length <= 160;
}

function hasKeywordSignals(text: string): boolean {
  return /(sách|tác giả|độc giả|thiếu nhi|văn học|triết học|nghệ thuật|lịch sử|khoa học|giáo dục)/i.test(text);
}

function hasCleanHtml(html: string): boolean {
  return !/<script|<iframe|style=|&nbsp;&nbsp;|\s{4,}/i.test(html);
}

export function auditProductSeoMarketing(product: NormalizedSapoProduct): ProductSeoMarketingAudit {
  const html = product.bodyHtml ?? product.description ?? "";
  const plainText = stripHtml(html);
  const lowerHtml = html.toLowerCase();
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

  if (hasKeywordSignals(`${plainText} ${(product.tags ?? []).join(" ")}`)) {
    currentSeoScore += 15;
  } else {
    opportunities.push("Có thể bổ sung keyword liên quan chủ đề, độc giả hoặc dòng sách.");
  }

  if (countWords(plainText) > 300) {
    currentSeoScore += 10;
  } else {
    opportunities.push("Mô tả hiện còn ngắn, có thể bổ sung thông tin hữu ích nếu dữ liệu đủ.");
  }

  if (hasCleanHtml(html)) {
    currentSeoScore += 15;
  } else {
    issues.push("HTML mô tả có dấu hiệu chưa sạch hoặc spacing bất thường.");
  }

  if (/phù hợp với ai|dành cho ai|ai nên đọc/i.test(lowerText)) {
    currentMarketingScore += 20;
  } else {
    opportunities.push("Có thể thêm phần sách phù hợp với nhóm độc giả nào.");
  }

  if (/<ul|<li/i.test(html)) {
    currentMarketingScore += 20;
  } else {
    opportunities.push("Có thể thêm bullet điểm nổi bật để người đọc quét nhanh.");
  }

  if (/mua ngay|đặt mua|tìm đọc|xem thêm|tham khảo/i.test(lowerText)) {
    currentMarketingScore += 15;
  } else {
    opportunities.push("Có thể thêm CTA mềm, không quá quảng cáo.");
  }

  if (/độc giả|phụ huynh|học sinh|sinh viên|người đọc|trẻ em|thiếu nhi/i.test(lowerText)) {
    currentMarketingScore += 20;
  } else {
    opportunities.push("Nên làm rõ lợi ích hoặc nhóm độc giả mục tiêu nếu dữ liệu cho phép.");
  }

  if (/nhã nam|biên tập|tác giả|dịch giả|nhà xuất bản/i.test(lowerText)) {
    currentMarketingScore += 15;
  } else {
    opportunities.push("Có thể tăng giọng biên tập đáng tin bằng dữ liệu hiện có.");
  }

  if (!/tuyệt phẩm|hay nhất|không thể bỏ qua|đỉnh cao|số một/i.test(lowerHtml)) {
    currentMarketingScore += 10;
  } else {
    issues.push("Mô tả có dấu hiệu quảng cáo quá đà.");
  }

  return {
    currentSeoScore: Math.min(currentSeoScore, 100),
    currentMarketingScore: Math.min(currentMarketingScore, 100),
    issues,
    opportunities
  };
}
