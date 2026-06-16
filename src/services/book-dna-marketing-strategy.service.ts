import fs from "node:fs";
import path from "node:path";
import { logger } from "../utils/logger";

const STRATEGY_FILE_NAME = "book-dna-marketing-strategy.md";
const MAX_STRATEGY_PROMPT_LENGTH = 22000;

let cachedStrategyPrompt: string | null = null;

export function getBookDnaMarketingStrategyPrompt(): string {
  if (cachedStrategyPrompt) {
    return cachedStrategyPrompt;
  }

  const rawStrategy = readStrategyFile();
  if (!rawStrategy) {
    cachedStrategyPrompt = [
      "BOOK DNA MARKETING STRATEGY FILE NOT FOUND.",
      "Use the existing Book DNA rules in this prompt and keep claims conservative."
    ].join("\n");
    return cachedStrategyPrompt;
  }

  const selectedSections = [
    excerptSection(rawStrategy, "## 1. Purpose", 2200),
    excerptSection(rawStrategy, "## 6. Book DNA Framework", 5200),
    excerptSection(rawStrategy, "## 8. Positioning Framework", 5200),
    excerptSection(rawStrategy, "## 9. Marketing Strategy Framework", 3200),
    excerptFromMarker(rawStrategy, "Content rules:", 3200),
    excerptSection(rawStrategy, "## 15. Risk Audit Framework", 3200),
    excerptSection(rawStrategy, "## 17. Self-Audit Checklist", 2600)
  ]
    .filter(Boolean)
    .join("\n\n");

  const strategyPrompt = [
    "LOCAL BOOK DNA MARKETING STRATEGY",
    "Use this local strategy file as the operating framework before writing.",
    "Prioritize Book DNA Intake, Editorial Diagnosis, Positioning & Audience Map, Marketing Strategy, Content Rules, Risk Audit, and Self-Audit.",
    "Do not output the full strategy file. Apply it to the product.",
    "",
    truncateStrategy(selectedSections || rawStrategy)
  ].join("\n");

  cachedStrategyPrompt = strategyPrompt;
  return cachedStrategyPrompt;
}

function readStrategyFile(): string | null {
  const candidates = [
    path.resolve(process.cwd(), STRATEGY_FILE_NAME),
    path.resolve(__dirname, "..", "..", STRATEGY_FILE_NAME),
    path.resolve(__dirname, "..", "..", "..", STRATEGY_FILE_NAME)
  ];

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        return fs.readFileSync(candidate, "utf8");
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Unknown read error";
      logger.warn("book_dna_marketing_strategy_read_failed", { path: candidate, reason });
    }
  }

  logger.warn("book_dna_marketing_strategy_not_found", { fileName: STRATEGY_FILE_NAME });
  return null;
}

function extractSection(markdown: string, heading: string): string {
  const start = markdown.indexOf(heading);
  if (start < 0) {
    return "";
  }

  const rest = markdown.slice(start);
  const nextHeading = rest.slice(heading.length).search(/\n## \d+\. /);
  if (nextHeading < 0) {
    return rest.trim();
  }

  return rest.slice(0, heading.length + nextHeading).trim();
}

function excerptSection(markdown: string, heading: string, maxLength: number): string {
  return truncateText(extractSection(markdown, heading), maxLength);
}

function excerptFromMarker(markdown: string, marker: string, maxLength: number): string {
  const start = markdown.indexOf(marker);
  if (start < 0) {
    return "";
  }

  const rest = markdown.slice(start);
  const nextHeading = rest.search(/\n## \d+\. /);
  const section = nextHeading < 0 ? rest : rest.slice(0, nextHeading);
  return truncateText(section, maxLength);
}

function truncateStrategy(text: string): string {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (normalized.length <= MAX_STRATEGY_PROMPT_LENGTH) {
    return normalized;
  }

  return `${normalized.slice(0, MAX_STRATEGY_PROMPT_LENGTH).trim()}\n\n[Strategy excerpt truncated for prompt size.]`;
}

function truncateText(text: string, maxLength: number): string {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!normalized || normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength).trim()}\n\n[Section excerpt truncated.]`;
}
