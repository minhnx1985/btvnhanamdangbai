const BRACKET_PATTERNS = [
  /\([^()]*\)/g,
  /\[[^\[\]]*\]/g,
  /\{[^{}]*\}/g,
  /（[^（）]*）/g,
  /【[^【】]*】/g,
  /《[^《》]*》/g
];

const PRICE_PATTERNS = [
  /\b(?:giá|gia)(?:\s+(?:bìa|bia|bán|ban|sale|km|khuyến\s+mãi|khuyen\s+mai))?\s*[:：]?\s*\d{1,3}(?:[.,]\d{3})*(?:\s*(?:đ|₫|vnd|vnđ|k))?/giu,
  /\b\d{1,3}(?:[.,]\d{3})+(?:\s*(?:đ|₫|vnd|vnđ))?/giu,
  /\b\d+\s*(?:đ|₫|vnd|vnđ|k)\b/giu
];

const BOOKISH_PREFIX_WORDS = new Set([
  "a",
  "an",
  "and",
  "bi",
  "bí",
  "bo",
  "bộ",
  "cau",
  "câu",
  "chuyen",
  "chuyện",
  "con",
  "cuoc",
  "cuộc",
  "cua",
  "của",
  "doi",
  "đời",
  "hieu",
  "hiệu",
  "how",
  "lich",
  "lịch",
  "mot",
  "một",
  "nghe",
  "nghệ",
  "nguoi",
  "người",
  "nha",
  "nhà",
  "nhung",
  "những",
  "sach",
  "sách",
  "su",
  "sự",
  "the",
  "thế",
  "thuat",
  "thuật",
  "tieu",
  "tiểu",
  "trong",
  "truyen",
  "truyện",
  "ung",
  "ứng",
  "va",
  "và",
  "what",
  "when",
  "where",
  "who",
  "why",
  "voi",
  "với"
]);

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

function extractLeadingBracketedText(value: string): { prefix: string; rest: string } | null {
  const match =
    value.match(/^\s*\(([^()]+)\)\s*(.+)$/u) ??
    value.match(/^\s*\[([^\[\]]+)\]\s*(.+)$/u) ??
    value.match(/^\s*\{([^{}]+)\}\s*(.+)$/u) ??
    value.match(/^\s*（([^（）]+)）\s*(.+)$/u) ??
    value.match(/^\s*【([^【】]+)】\s*(.+)$/u);

  if (!match) {
    return null;
  }

  return {
    prefix: cleanupTitle(match[1] ?? ""),
    rest: cleanupTitle(match[2] ?? "")
  };
}

function isLikelySeriesPrefix(value: string): boolean {
  const prefix = cleanupTitle(value);
  const normalized = removeDiacritics(prefix).toLocaleLowerCase("vi-VN");
  const words = normalized.match(/[\p{L}\p{N}+]+/gu) ?? [];

  if (words.length < 2 || prefix.length > 80) {
    return false;
  }

  if (/\b(?:tb|tai ban|tang|kem|bia|gia|nhanam|nha nam|isbn|sku)\b/u.test(normalized)) {
    return false;
  }

  return true;
}

function restoreLeadingSeriesPrefix(value: string): string | null {
  const leading = extractLeadingBracketedText(value);
  if (!leading || !isLikelySeriesPrefix(leading.prefix)) {
    return null;
  }

  const rest = cleanupTitle(removePriceText(removeBracketedText(leading.rest)));
  if (!rest) {
    return null;
  }

  return `${leading.prefix}: ${rest}`;
}

function isProductVariantAttribute(value: string): boolean {
  const normalized = removeDiacritics(cleanupTitle(value)).toLocaleLowerCase("vi-VN");

  if (!normalized || /\b(?:gia|vnd|isbn|sku|nha nam|nhanam)\b/u.test(normalized)) {
    return false;
  }

  return /\b(?:khong kem|khong co|co kem|kem|hop|bia cung|bia mem|ban dac biet|limited)\b/u.test(normalized);
}

function extractProductVariantAttributes(rawTitle: string): string[] {
  const attributes: string[] = [];
  const pattern = /\(([^()]+)\)|\[([^\[\]]+)\]|\{([^{}]+)\}|（([^（）]+)）|【([^【】]+)】/gu;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(rawTitle)) !== null) {
    const value = cleanupTitle(match.slice(1).find((item) => typeof item === "string" && item.trim().length > 0) ?? "");
    if (value && isProductVariantAttribute(value)) {
      attributes.push(value);
    }
  }

  return attributes.filter(
    (attribute, index, values) =>
      values.findIndex((item) => item.toLocaleLowerCase("vi-VN") === attribute.toLocaleLowerCase("vi-VN")) === index
  );
}

function appendProductVariantAttributes(finalTitle: string, rawTitle: string): string {
  const attributes = extractProductVariantAttributes(rawTitle);
  if (attributes.length === 0) {
    return finalTitle;
  }

  const normalizedFinalTitle = removeDiacritics(finalTitle).toLocaleLowerCase("vi-VN");
  const suffix = attributes
    .filter((attribute) => !normalizedFinalTitle.includes(removeDiacritics(attribute).toLocaleLowerCase("vi-VN")))
    .map((attribute) => `(${attribute.toLocaleUpperCase("vi-VN")})`)
    .join(" ");

  return suffix ? `${finalTitle} ${suffix}` : finalTitle;
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

function removeDiacritics(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D");
}

function isUppercaseWord(word: string): boolean {
  return word === word.toLocaleUpperCase("vi-VN");
}

function isCapitalizedWord(word: string): boolean {
  const firstLetter = word.match(/\p{L}/u)?.[0];
  return !!firstLetter && firstLetter === firstLetter.toLocaleUpperCase("vi-VN");
}

function isLikelyAuthorPrefix(value: string): boolean {
  if (/[0-9,!?;:]/u.test(value)) {
    return false;
  }

  const words = value.match(/[\p{L}.]+/gu) ?? [];
  if (words.length < 2 || words.length > 5) {
    return false;
  }

  const normalizedWords = words.map((word) => removeDiacritics(word).toLocaleLowerCase("vi-VN").replace(/\./g, ""));
  if (normalizedWords.some((word) => BOOKISH_PREFIX_WORDS.has(word))) {
    return false;
  }

  return words.every((word) => isCapitalizedWord(word) || isUppercaseWord(word));
}

function isLikelyAuthorSuffix(value: string): boolean {
  return isLikelyAuthorPrefix(value) && /^[A-Za-z.'\-\s]+$/.test(value.trim());
}

function removeLikelyAuthorSuffix(value: string): string {
  const parts = value
    .split(/\s+[-–—]\s+/u)
    .map((part) => cleanupTitle(part))
    .filter(Boolean);

  if (parts.length !== 2) {
    return cleanupTitle(value);
  }

  const [title, possibleAuthor] = parts;
  if (!title || !possibleAuthor || !isLikelyAuthorSuffix(possibleAuthor)) {
    return cleanupTitle(value);
  }

  return cleanupTitle(title);
}

function removeCatalogPrefix(value: string): string {
  const withoutBookLabel = value.replace(/^\s*(?:sách|sach|book)\s*[:：\-–—]\s*/iu, "");
  const withoutAuthorSuffix = removeLikelyAuthorSuffix(withoutBookLabel);
  if (withoutAuthorSuffix !== cleanupTitle(withoutBookLabel)) {
    return withoutAuthorSuffix;
  }

  const parts = withoutBookLabel
    .split(/\s+[-–—]\s+/u)
    .map((part) => cleanupTitle(part))
    .filter(Boolean);

  if (parts.length < 2) {
    return cleanupTitle(withoutBookLabel);
  }

  const [prefix, ...rest] = parts;
  if (isLikelyAuthorPrefix(prefix)) {
    return cleanupTitle(rest.join(" - "));
  }

  return cleanupTitle(withoutBookLabel);
}

export function isComboProductTitle(rawTitle: string, alias?: string): boolean {
  return /^combo(?:\b|[-_])/iu.test(rawTitle.trim()) || /^combo(?:\b|[-_])/iu.test(alias?.trim() ?? "");
}

export function cleanProductTitle(rawTitle: string): string {
  const withSeriesPrefix = restoreLeadingSeriesPrefix(rawTitle);
  const sourceTitle = withSeriesPrefix ?? removeBracketedText(rawTitle);
  return removeCatalogPrefix(cleanupTitle(removePriceText(sourceTitle)));
}

function removeComboPrefix(value: string): string {
  return value
    .replace(/^\s*combo\s*\+\s*[^:：]+[:：]\s*/iu, "")
    .replace(/^\s*(?:combo sách|combo sach|bộ combo|bo combo|combo)\s*[:：\-–—]?\s*/iu, "")
    .trim();
}

function cleanComboName(value: string): string {
  const source = value.split(/[:：]/u, 1)[0] ?? value;

  return cleanupTitle(source)
    .replace(/^(?:combo sách|combo sach|bộ combo|bo combo|combo)\s*[:：\-–—+]?\s*/iu, "")
    .trim();
}

function extractExistingMarketingComboName(value: string): string {
  const match = value.match(/^\s*combo\s*\+?\s*([^:：]+)[:：]\s*(.+)$/iu);
  if (!match) {
    return "";
  }

  return cleanComboName(match[1] ?? "");
}

function isCatalogNumberComboTitle(value: string): boolean {
  const normalized = value.trim();
  return (
    /^combo\s+\d{1,4}\b/iu.test(normalized) ||
    /^\d{1,3}\s+[\p{L}\p{N}]/u.test(normalized) ||
    /^\d{1,3}\s*[-–—]\s*(?:combo|bộ|bo|tác giả|tac gia)\b/iu.test(normalized)
  );
}

function removeComboCatalogNumber(value: string): string {
  return cleanupTitle(value.replace(/^(?:combo\s+)?\d{1,4}\s*(?:[-–—]\s*)?/iu, ""));
}

function isComboSetDescriptor(value: string): boolean {
  const normalized = removeDiacritics(value).toLocaleLowerCase("vi-VN").trim();
  return (
    /\b\d+\s*(?:cuon|quyen|tap|volumes?|books?)\b/u.test(normalized) ||
    /^(?:bo|tron bo|tu sach)\b/u.test(normalized)
  );
}

export function extractComboBookTitles(rawTitle: string): string[] {
  const cleanedTitle = cleanProductTitle(rawTitle);
  const withoutComboPrefix = removeComboPrefix(cleanedTitle);

  if (isCatalogNumberComboTitle(withoutComboPrefix) || isComboSetDescriptor(withoutComboPrefix)) {
    return [];
  }

  return withoutComboPrefix
    .split(/\s+(?:và|va)\s+|\s*[+&]\s*/iu)
    .map((item) => removeCatalogPrefix(cleanupTitle(item)))
    .filter(Boolean);
}

export function extractComboNameSeed(rawTitle: string): string {
  const cleanedTitle = cleanProductTitle(rawTitle);
  const existingMarketingComboName = extractExistingMarketingComboName(cleanedTitle);
  if (existingMarketingComboName) {
    return existingMarketingComboName;
  }

  const withoutComboPrefix = removeComboPrefix(cleanedTitle);
  return isCatalogNumberComboTitle(withoutComboPrefix)
    ? cleanComboName(removeComboCatalogNumber(withoutComboPrefix))
    : cleanComboName(withoutComboPrefix);
}

export function formatMarketingComboProductTitle(comboName: string, bookTitles: string[]): string {
  const normalizedComboName = cleanComboName(comboName).toLocaleUpperCase("vi-VN");
  const normalizedBookTitles = bookTitles
    .map((title) => cleanupTitle(title).toLocaleUpperCase("vi-VN"))
    .filter(Boolean);

  if (!normalizedComboName) {
    return "";
  }

  if (normalizedBookTitles.length === 0) {
    return `COMBO ${normalizedComboName}`;
  }

  return `COMBO ${normalizedComboName}: ${normalizedBookTitles.join(" - ")}`;
}

export function normalizeProductTitleForBook(rawTitle: string, options: { alias?: string } = {}): string {
  const cleaned = cleanProductTitle(rawTitle);
  if (isComboProductTitle(rawTitle, options.alias)) {
    const bookTitles = extractComboBookTitles(rawTitle);
    const fallbackComboName = bookTitles.length > 1 ? bookTitles.join(" - ") : extractComboNameSeed(rawTitle);
    return appendProductVariantAttributes(formatMarketingComboProductTitle(fallbackComboName, bookTitles), rawTitle);
  }

  return appendProductVariantAttributes(cleaned.toLocaleUpperCase("vi-VN"), rawTitle);
}
