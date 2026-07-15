import fs from "fs";
import path from "path";
import { ProductLinkCandidate } from "../types/sapo";
import { logger } from "../utils/logger";

const DEFAULT_CATALOG_FILE = "ten_sach_tong_hop_2_links_nhanam.csv";
const MIN_TITLE_MATCH_LENGTH = 4;
const MIN_SHORT_TITLE_MATCH_LENGTH = 8;
const MAX_AUTO_PRODUCT_LINKS = 10;

type CatalogProductLink = ProductLinkCandidate & {
  matchTitles: string[];
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

function normalizeForMatch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "d")
    .toLocaleLowerCase("vi")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function titleAppearsInText(normalizedText: string, normalizedTitle: string, minLength = MIN_TITLE_MATCH_LENGTH): boolean {
  if (normalizedTitle.length < minLength) {
    return false;
  }

  const pattern = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(normalizedTitle)}(?=$|[^\\p{L}\\p{N}])`, "u");
  return pattern.test(normalizedText);
}

function buildMatchTitles(title: string): string[] {
  const normalizedTitle = normalizeForMatch(title);
  const shortTitle = normalizeForMatch(title.split(/\s+[-–—:]\s+/)[0] ?? "");

  return [normalizedTitle, shortTitle]
    .filter((item, index, items) => item && items.indexOf(item) === index);
}

class ProductLinkCatalogService {
  private catalog: CatalogProductLink[] | undefined;

  findProductLinksInText(text: string): ProductLinkCandidate[] {
    const normalizedText = normalizeForMatch(text);
    if (!normalizedText) {
      return [];
    }

    const seenUrls = new Set<string>();
    const matches: ProductLinkCandidate[] = [];

    for (const item of this.loadCatalog()) {
      const didMatch = item.matchTitles.some((matchTitle, index) =>
        titleAppearsInText(normalizedText, matchTitle, index === 0 ? MIN_TITLE_MATCH_LENGTH : MIN_SHORT_TITLE_MATCH_LENGTH)
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
        .sort((a, b) => b.matchTitles[0].length - a.matchTitles[0].length);

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
