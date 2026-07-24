const BRACKET_PATTERNS = [
  /\([^()]*\)/g,
  /\[[^\[\]]*\]/g,
  /\{[^{}]*\}/g,
  /（[^（）]*）/g,
  /【[^【】]*】/g,
  /《[^《》]*》/g
];

const PRICE_PATTERNS = [
  /(?:giá|gia)(?:\s+\S+){0,4}\s*[:：]?\s*\d{1,3}(?:[.,]\d{3})*(?:\s*(?:đ|₫|vnd|vnđ|k))?/giu,
  /\b\d{1,3}(?:[.,]\d{3})+(?:\s*(?:đ|₫|vnd|vnđ))?/giu,
  /\b\d+\s*(?:đ|₫|vnd|vnđ|k)\b/giu
];

function removeBracketedText(value: string): string {
  let next = value;
  let previous = "";

  while (next !== previous) {
    previous = next;
    for (const pattern of BRACKET_PATTERNS) {
      next = next.replace(pattern, " ");
    }
  }

  return next;
}

function removePriceText(value: string): string {
  return PRICE_PATTERNS.reduce((result, pattern) => result.replace(pattern, " "), value);
}

function cleanupTitle(value: string): string {
  return value
    .replace(/[|]/g, " ")
    .replace(/\s+[,]+\s*$/g, " ")
    .replace(/\s+[-–—:;,/]+\s*$/g, " ")
    .replace(/^\s*[-–—:;,/]+\s+/g, " ")
    .replace(/\s+[-–—:;,/]+\s+[-–—:;,/]+\s+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isComboProductTitle(rawTitle: string, alias?: string): boolean {
  return /^combo(?:\b|[-_])/iu.test(rawTitle.trim()) || /^combo(?:\b|[-_])/iu.test(alias?.trim() ?? "");
}

export function cleanProductTitle(rawTitle: string): string {
  return cleanupTitle(removePriceText(removeBracketedText(rawTitle)));
}

function removeComboPrefix(value: string): string {
  return value
    .replace(/^\s*combo\s*\+\s*[^:：]+[:：]\s*/iu, "")
    .replace(/^\s*(?:combo sách|combo sach|bộ combo|bo combo|combo)\s*[:：\-–—]?\s*/iu, "")
    .trim();
}

export function extractComboBookTitles(rawTitle: string): string[] {
  const cleanedTitle = cleanProductTitle(rawTitle);
  return removeComboPrefix(cleanedTitle)
    .split(/\s+(?:và|va)\s+|\s*[+&]\s*/iu)
    .map((item) => cleanupTitle(item))
    .filter(Boolean);
}

export function formatMarketingComboProductTitle(comboName: string, bookTitles: string[]): string {
  const normalizedComboName = cleanupTitle(comboName).toLocaleUpperCase("vi-VN");
  const normalizedBookTitles = bookTitles
    .map((title) => cleanupTitle(title).toLocaleUpperCase("vi-VN"))
    .filter(Boolean);

  if (!normalizedComboName || normalizedBookTitles.length === 0) {
    return "";
  }

  return `COMBO + ${normalizedComboName}: ${normalizedBookTitles.join(", ")}`;
}

export function normalizeProductTitleForBook(rawTitle: string, options: { alias?: string } = {}): string {
  const cleaned = cleanProductTitle(rawTitle);
  if (isComboProductTitle(rawTitle, options.alias)) {
    const bookTitles = extractComboBookTitles(rawTitle);
    const fallbackComboName = bookTitles.length > 1 ? bookTitles.join(" - ") : removeComboPrefix(cleaned);
    return formatMarketingComboProductTitle(fallbackComboName, bookTitles.length > 0 ? bookTitles : [fallbackComboName]);
  }

  return cleaned.toLocaleUpperCase("vi-VN");
}
