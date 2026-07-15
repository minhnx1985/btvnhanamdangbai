import fs from "fs";
import path from "path";
import { ProductLinkCandidate } from "../types/sapo";
import { logger } from "../utils/logger";

const DEFAULT_CATALOG_FILE = "ten_sach_tong_hop_2_links_nhanam.csv";
const MIN_TITLE_MATCH_LENGTH = 4;
const MIN_SHORT_TITLE_MATCH_LENGTH = 8;
const MIN_FOLDED_TITLE_MATCH_LENGTH = 10;
const MIN_FOLDED_TITLE_WORDS = 3;
const MAX_AUTO_PRODUCT_LINKS = 10;

type MatchTitle = {
  value: string;
  minLength: number;
  folded: boolean;
};

type CatalogProductLink = ProductLinkCandidate & {
  matchTitles: MatchTitle[];
};

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const nextChar = line[index + 1];

    if (char === '"' && inQuotes && nextChar === '"') {
      current += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === "," && !inQuotes) {
      cells.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  cells.push(current);
  return cells.map((cell) => cell.trim());
}

function normalizeText(value: string): string {
  return value
    .normalize("NFC")
    .toLocaleLowerCase("vi")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function foldVietnamese(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "d");
}

function titleAppearsInText(normalizedText: string, normalizedTitle: string, minLength = MIN_TITLE_MATCH_LENGTH): boolean {
  if (normalizedTitle.length < minLength) {
    return false;
  }

  return normalizedText.includes(` ${normalizedTitle} `);
}

function canUseFoldedMatch(value: string): boolean {
  const words = value
    .split(/\s+/)
    .map((word) => word.trim())
    .filter(Boolean);

  return value.length >= MIN_FOLDED_TITLE_MATCH_LENGTH && words.length >= MIN_FOLDED_TITLE_WORDS;
}

function buildMatchTitles(title: string): MatchTitle[] {
  const normalizedTitle = normalizeText(title);
  const shortTitle = normalizeText(title.split(/\s+[-–—:]\s+/)[0] ?? "");
  const baseTitles = [normalizedTitle, shortTitle]
    .filter((item, index, items) => item && items.indexOf(item) === index);
  const matchTitles: MatchTitle[] = [];

  for (const [index, value] of baseTitles.entries()) {
    const minLength = index === 0 ? MIN_TITLE_MATCH_LENGTH : MIN_SHORT_TITLE_MATCH_LENGTH;
    matchTitles.push({ value, minLength, folded: false });

    const foldedValue = foldVietnamese(value);
    if (foldedValue !== value && canUseFoldedMatch(foldedValue)) {
      matchTitles.push({
        value: foldedValue,
        minLength: Math.max(minLength, MIN_FOLDED_TITLE_MATCH_LENGTH),
        folded: true
      });
    }
  }

  return matchTitles;
}

class ProductLinkCatalogService {
  private catalog: CatalogProductLink[] | undefined;

  findProductLinksInText(text: string): ProductLinkCandidate[] {
    const normalizedText = ` ${normalizeText(text)} `;
    if (normalizedText.trim().length === 0) {
      return [];
    }

    const foldedText = foldVietnamese(normalizedText);
    const seenUrls = new Set<string>();
    const matches: ProductLinkCandidate[] = [];

    for (const item of this.loadCatalog()) {
      const didMatch = item.matchTitles.some((matchTitle) =>
        titleAppearsInText(matchTitle.folded ? foldedText : normalizedText, matchTitle.value, matchTitle.minLength)
      );

      if (!didMatch || seenUrls.has(item.url)) {
        continue;
      }

      seenUrls.add(item.url);
      matches.push(item);

      if (matches.length >= MAX_AUTO_PRODUCT_LINKS) {
        break;
      }
    }

    return matches;
  }

  private loadCatalog(): CatalogProductLink[] {
    if (this.catalog) {
      return this.catalog;
    }

    const filePath = path.join(process.cwd(), DEFAULT_CATALOG_FILE);

    try {
      const rawCsv = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
      this.catalog = rawCsv
        .split(/\r?\n/)
        .slice(1)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const [title, url] = parseCsvLine(line);
          return { title, url, matchTitles: title ? buildMatchTitles(title) : [] };
        })
        .filter((item) => item.title && item.url?.startsWith("http"))
        .sort((a, b) => b.matchTitles[0].value.length - a.matchTitles[0].value.length);

      logger.info("product_link_catalog_loaded", { count: this.catalog.length, file: DEFAULT_CATALOG_FILE });
      return this.catalog;
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Không đọc được file CSV sản phẩm";
      logger.warn("product_link_catalog_load_failed", { reason, file: DEFAULT_CATALOG_FILE });
      this.catalog = [];
      return this.catalog;
    }
  }
}

export const productLinkCatalogService = new ProductLinkCatalogService();
