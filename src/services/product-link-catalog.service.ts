import fs from "fs";
import path from "path";
import { ProductLinkCandidate } from "../types/sapo";
import { logger } from "../utils/logger";

const DEFAULT_CATALOG_FILE = "ten_sach_tong_hop_2_links_nhanam.csv";
const MIN_TITLE_MATCH_LENGTH = 4;
const MAX_AUTO_PRODUCT_LINKS = 10;

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
    .normalize("NFC")
    .toLocaleLowerCase("vi")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function titleAppearsInText(normalizedText: string, normalizedTitle: string): boolean {
  if (normalizedTitle.length < MIN_TITLE_MATCH_LENGTH) {
    return false;
  }

  const pattern = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(normalizedTitle)}(?=$|[^\\p{L}\\p{N}])`, "u");
  return pattern.test(normalizedText);
}

class ProductLinkCatalogService {
  private catalog: ProductLinkCandidate[] | undefined;

  findProductLinksInText(text: string): ProductLinkCandidate[] {
    const normalizedText = normalizeForMatch(text);
    if (!normalizedText) {
      return [];
    }

    const seenUrls = new Set<string>();
    const matches: ProductLinkCandidate[] = [];

    for (const item of this.loadCatalog()) {
      const normalizedTitle = normalizeForMatch(item.title);
      if (!titleAppearsInText(normalizedText, normalizedTitle) || seenUrls.has(item.url)) {
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

  private loadCatalog(): ProductLinkCandidate[] {
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
          return { title, url };
        })
        .filter((item) => item.title && item.url?.startsWith("http"))
        .sort((a, b) => b.title.length - a.title.length);

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
