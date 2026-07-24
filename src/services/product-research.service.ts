import axios, { AxiosInstance } from "axios";
import { NormalizedSapoProduct, ProductResearchSource } from "../types/product-seo.types";
import { logger } from "../utils/logger";

type WikipediaSearchResponse = {
  query?: {
    search?: Array<{
      title?: string;
      snippet?: string;
    }>;
  };
};

type WikipediaSummaryResponse = {
  title?: string;
  extract?: string;
  content_urls?: {
    desktop?: {
      page?: string;
    };
  };
};

type DuckDuckGoResponse = {
  AbstractText?: string;
  AbstractURL?: string;
  Heading?: string;
  RelatedTopics?: Array<{
    Text?: string;
    FirstURL?: string;
  }>;
};

const MAX_RESEARCH_SOURCES = 5;
const MAX_COMBO_BOOK_TITLES = 4;
const MAX_COMBO_RESEARCH_SOURCES = 8;
const MAX_RESEARCH_SOURCES_PER_BOOK = 2;

class ProductResearchService {
  private readonly client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      timeout: 10000,
      headers: {
        Accept: "application/json",
        "User-Agent": "telegram-sapo-bot/1.0"
      }
    });
  }

  async researchProduct(product: NormalizedSapoProduct): Promise<ProductResearchSource[]> {
    const queries = buildResearchQueries(product);
    const sources: ProductResearchSource[] = [];

    for (const query of queries) {
      const [wikipediaVi, wikipediaEn, duckDuckGo] = await Promise.all([
        this.searchWikipedia(query, "vi"),
        this.searchWikipedia(query, "en"),
        this.searchDuckDuckGo(query)
      ]);
      sources.push(...wikipediaVi, ...wikipediaEn, ...duckDuckGo);

      if (sources.length >= MAX_RESEARCH_SOURCES) {
        break;
      }
    }

    return dedupeSources(sources).slice(0, MAX_RESEARCH_SOURCES);
  }

  async researchComboBooks(bookTitles: string[], product: NormalizedSapoProduct): Promise<ProductResearchSource[]> {
    const bookSourceGroups = await Promise.all(
      bookTitles.slice(0, MAX_COMBO_BOOK_TITLES).map(async (bookTitle) => {
        const querySourceGroups = await Promise.all(
          buildBookTitleResearchQueries(bookTitle, product).map(async (query) => {
            const [wikipediaVi, wikipediaEn, duckDuckGo] = await Promise.all([
              this.searchWikipedia(query, "vi"),
              this.searchWikipedia(query, "en"),
              this.searchDuckDuckGo(query)
            ]);
            return [...wikipediaVi, ...wikipediaEn, ...duckDuckGo];
          })
        );

        return dedupeSources(querySourceGroups.flat()).slice(0, MAX_RESEARCH_SOURCES_PER_BOOK);
      })
    );

    return dedupeSources(bookSourceGroups.flat()).slice(0, MAX_COMBO_RESEARCH_SOURCES);
  }

  private async searchWikipedia(query: string, language: "vi" | "en"): Promise<ProductResearchSource[]> {
    try {
      const searchUrl = `https://${language}.wikipedia.org/w/api.php`;
      const response = await this.client.get<WikipediaSearchResponse>(searchUrl, {
        params: {
          action: "query",
          list: "search",
          srsearch: query,
          format: "json",
          utf8: 1,
          origin: "*"
        }
      });

      const title = response.data.query?.search?.[0]?.title;
      if (!title) {
        return [];
      }

      const summary = await this.fetchWikipediaSummary(title, language);
      return summary ? [summary] : [];
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Wikipedia search failed";
      logger.warn("product_external_research_source_failed", { source: `wikipedia_${language}`, reason });
      return [];
    }
  }

  private async fetchWikipediaSummary(title: string, language: "vi" | "en"): Promise<ProductResearchSource | null> {
    try {
      const response = await this.client.get<WikipediaSummaryResponse>(
        `https://${language}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`
      );
      const summary = response.data.extract?.trim();

      if (!summary) {
        return null;
      }

      return {
        source: `Wikipedia ${language.toUpperCase()}`,
        title: response.data.title ?? title,
        url: response.data.content_urls?.desktop?.page,
        summary: summary.slice(0, 1000)
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Wikipedia summary failed";
      logger.warn("product_external_research_source_failed", { source: `wikipedia_${language}_summary`, reason });
      return null;
    }
  }

  private async searchDuckDuckGo(query: string): Promise<ProductResearchSource[]> {
    try {
      const response = await this.client.get<DuckDuckGoResponse>("https://api.duckduckgo.com/", {
        params: {
          q: query,
          format: "json",
          no_html: 1,
          skip_disambig: 1,
          no_redirect: 1
        }
      });
      const sources: ProductResearchSource[] = [];

      if (response.data.AbstractText?.trim()) {
        sources.push({
          source: "DuckDuckGo",
          title: response.data.Heading?.trim() || query,
          url: response.data.AbstractURL,
          summary: response.data.AbstractText.trim().slice(0, 1000)
        });
      }

      for (const topic of response.data.RelatedTopics ?? []) {
        if (!topic.Text?.trim()) {
          continue;
        }

        sources.push({
          source: "DuckDuckGo",
          title: topic.Text.split(" - ")[0]?.trim() || query,
          url: topic.FirstURL,
          summary: topic.Text.trim().slice(0, 700)
        });
      }

      return sources.slice(0, 3);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "DuckDuckGo search failed";
      logger.warn("product_external_research_source_failed", { source: "duckduckgo", reason });
      return [];
    }
  }
}

function buildResearchQueries(product: NormalizedSapoProduct): string[] {
  const author = extractPossibleAuthor(product.raw);
  const title = product.title.trim();
  const tags = (product.tags ?? []).slice(0, 3).join(" ");
  const queries = [
    [title, author].filter(Boolean).join(" "),
    [title, "sách", author].filter(Boolean).join(" "),
    [title, tags].filter(Boolean).join(" ")
  ];

  return [...new Set(queries.map((query) => query.trim()).filter(Boolean))].slice(0, 3);
}

function buildBookTitleResearchQueries(bookTitle: string, product: NormalizedSapoProduct): string[] {
  const title = bookTitle.trim();
  const tags = (product.tags ?? []).slice(0, 2).join(" ");
  const queries = [
    [title, "sách"].filter(Boolean).join(" "),
    [title, "Nhã Nam"].filter(Boolean).join(" "),
    [title, tags].filter(Boolean).join(" ")
  ];

  return [...new Set(queries.map((query) => query.trim()).filter(Boolean))].slice(0, 3);
}

function extractPossibleAuthor(raw: unknown): string | undefined {
  const matches: string[] = [];
  collectAuthorValues(raw, matches, 0);
  return matches.find((value) => value.length > 1 && value.length < 120);
}

function collectAuthorValues(value: unknown, matches: string[], depth: number): void {
  if (!value || depth > 4 || matches.length >= 3) {
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectAuthorValues(item, matches, depth + 1);
    }
    return;
  }

  if (typeof value !== "object") {
    return;
  }

  for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
    if (/author|tac_?gia|tác.?giả|writer/i.test(key) && typeof nestedValue === "string") {
      matches.push(nestedValue.trim());
    }
    collectAuthorValues(nestedValue, matches, depth + 1);
  }
}

function dedupeSources(sources: ProductResearchSource[]): ProductResearchSource[] {
  const seen = new Set<string>();
  const deduped: ProductResearchSource[] = [];

  for (const source of sources) {
    const key = `${source.url ?? ""}:${source.title}`.toLowerCase();
    if (seen.has(key) || !source.summary.trim()) {
      continue;
    }

    seen.add(key);
    deduped.push(source);
  }

  return deduped;
}

export const productResearchService = new ProductResearchService();
