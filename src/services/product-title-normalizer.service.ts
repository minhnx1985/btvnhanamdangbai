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
    .replace(/\s+[-–—:;,/]+\s*$/g, " ")
    .replace(/^\s*[-–—:;,/]+\s+/g, " ")
    .replace(/\s+[-–—:;,/]+\s+[-–—:;,/]+\s+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isComboProduct(rawTitle: string, alias?: string): boolean {
  return /^combo(?:\b|[-_])/iu.test(rawTitle.trim()) || /^combo(?:\b|[-_])/iu.test(alias?.trim() ?? "");
}

function removeComboPrefix(value: string): string {
  return value
    .replace(/^\s*(?:combo sách|combo sach|bộ combo|bo combo|combo)\s*[:：\-–—]?\s*/iu, "")
    .trim();
}

function splitComboBookTitles(value: string): string[] {
  return value
    .split(/\s+(?:và|va)\s+|\s*[+&]\s*/iu)
    .map((item) => cleanupTitle(item))
    .filter(Boolean);
}

function formatComboTitle(cleanedTitle: string): string {
  const titles = splitComboBookTitles(removeComboPrefix(cleanedTitle));
  const comboName = (titles.length > 0 ? titles : [removeComboPrefix(cleanedTitle)])
    .map((title) => title.toLocaleUpperCase("vi-VN"))
    .join(" - ");

  return comboName ? `COMBO + TÊN COMBO: ${comboName}` : "";
}

export function normalizeProductTitleForBook(rawTitle: string, options: { alias?: string } = {}): string {
  const cleaned = cleanupTitle(removePriceText(removeBracketedText(rawTitle)));
  if (isComboProduct(rawTitle, options.alias)) {
    return formatComboTitle(cleaned);
  }

  return cleaned.toLocaleUpperCase("vi-VN");
}
