import { shopApiService, ShopApiChatMessage } from "./shopapi.service";
import { logger } from "../utils/logger";

type RawDraftIntakeResult = {
  title?: unknown;
  content?: unknown;
};

export type DraftIntakeResult =
  | {
      kind: "title";
      title: string;
    }
  | {
      kind: "full_draft";
      title: string;
      content: string;
      source: "ai" | "fallback";
    };

const MIN_FULL_DRAFT_CHARACTERS = 220;
const MIN_FULL_DRAFT_LINES = 3;
const MAX_TITLE_LENGTH = 180;

export async function detectDraftIntake(text: string): Promise<DraftIntakeResult> {
  const normalized = normalizeInput(text);

  if (!looksLikeFullDraft(normalized)) {
    return {
      kind: "title",
      title: normalized
    };
  }

  try {
    const result = normalizeAiDraftIntakeResult(await shopApiService.generateJson<RawDraftIntakeResult>(buildMessages(normalized)));
    return {
      ...result,
      source: "ai"
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Unknown draft intake error";
    logger.warn("AI draft title detection fallback used", { reason });
    return {
      ...fallbackDraftIntake(normalized),
      source: "fallback"
    };
  }
}

function normalizeInput(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
}

function looksLikeFullDraft(text: string): boolean {
  const lines = getMeaningfulLines(text);
  const paragraphs = text.split(/\n\s*\n/).map((paragraph) => paragraph.trim()).filter(Boolean);

  return text.length >= MIN_FULL_DRAFT_CHARACTERS || lines.length >= MIN_FULL_DRAFT_LINES || (paragraphs.length >= 2 && text.length >= 120);
}

function buildMessages(text: string): ShopApiChatMessage[] {
  return [
    {
      role: "system",
      content: [
        "Ban la bien tap vien tieng Viet cho bot dang bai blog.",
        "Nhiem vu: doc ban nhap bai viet nguoi dung gui trong mot tin nhan Telegram, tach title va content.",
        "Khong viet lai content, khong tom tat, khong them thong tin, khong doi giong van.",
        "Neu van ban da co dong tieu de ro rang, dung dong do lam title va bo dong do khoi content.",
        "Neu khong co dong tieu de ro rang, tao mot title ngan, tu nhien dua tren noi dung va giu nguyen toan bo van ban lam content.",
        "Title toi da 180 ky tu, khong kem dau ngoac kep bao quanh.",
        "Content phai giu line breaks cua ban goc nhieu nhat co the.",
        "Tra ve JSON hop le dang {\"title\":\"...\",\"content\":\"...\"}.",
        "Khong markdown, khong giai thich."
      ].join("\n")
    },
    {
      role: "user",
      content: text
    }
  ];
}

function normalizeAiDraftIntakeResult(result: RawDraftIntakeResult): Omit<Extract<DraftIntakeResult, { kind: "full_draft" }>, "source"> {
  const title = typeof result.title === "string" ? cleanTitle(result.title) : "";
  const content = typeof result.content === "string" ? normalizeInput(result.content) : "";

  if (!isUsableTitle(title) || !isUsableContent(content)) {
    throw new Error("AI draft intake result is incomplete");
  }

  return {
    kind: "full_draft",
    title,
    content
  };
}

function fallbackDraftIntake(text: string): Omit<Extract<DraftIntakeResult, { kind: "full_draft" }>, "source"> {
  const lines = getMeaningfulLines(text);
  const firstLine = cleanTitle(lines[0] ?? "");
  const restAfterFirstLine = removeFirstMeaningfulLine(text);

  if (isUsableTitle(firstLine) && restAfterFirstLine.length >= 40) {
    return {
      kind: "full_draft",
      title: firstLine,
      content: restAfterFirstLine
    };
  }

  const firstSentence = cleanTitle(readFirstSentence(text));
  if (isUsableTitle(firstSentence)) {
    return {
      kind: "full_draft",
      title: firstSentence,
      content: text
    };
  }

  return {
    kind: "full_draft",
    title: cleanTitle(text.slice(0, MAX_TITLE_LENGTH)),
    content: text
  };
}

function getMeaningfulLines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function removeFirstMeaningfulLine(text: string): string {
  const lines = text.split("\n");
  const firstMeaningfulLineIndex = lines.findIndex((line) => line.trim().length > 0);

  if (firstMeaningfulLineIndex < 0) {
    return "";
  }

  return lines.slice(firstMeaningfulLineIndex + 1).join("\n").trim();
}

function cleanTitle(text: string): string {
  return text
    .trim()
    .replace(/^#+\s*/, "")
    .replace(/^title\s*:\s*/i, "")
    .replace(/^tieu de\s*:\s*/i, "")
    .replace(/^tiêu đề\s*:\s*/i, "")
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TITLE_LENGTH)
    .trim();
}

function readFirstSentence(text: string): string {
  const firstParagraph = text.split(/\n\s*\n/).map((paragraph) => paragraph.trim()).find(Boolean) ?? text.trim();
  const match = firstParagraph.match(/^(.{20,180}?[.!?…])(?:\s|$)/u);

  if (match) {
    return match[1];
  }

  const softBreak = firstParagraph.slice(0, MAX_TITLE_LENGTH);
  const lastComma = Math.max(softBreak.lastIndexOf(","), softBreak.lastIndexOf(";"), softBreak.lastIndexOf(":"));
  return lastComma >= 40 ? softBreak.slice(0, lastComma) : softBreak;
}

function isUsableTitle(title: string): boolean {
  return title.length >= 3 && title.length <= MAX_TITLE_LENGTH;
}

function isUsableContent(content: string): boolean {
  return content.length >= 40;
}
