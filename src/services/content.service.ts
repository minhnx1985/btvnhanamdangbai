import { LinkedProduct } from "../types/sapo";

type PlainTextToHtmlOptions = {
  embedDirectImageLinks?: boolean;
  linkedProducts?: LinkedProduct[];
};

type TextToken =
  | { type: "text"; value: string }
  | { type: "link"; value: string; href: string };

const PARAGRAPH_SPACER = "<br />&nbsp;<br />";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isDirectImageUrl(text: string): boolean {
  return /^https?:\/\/\S+\.(jpg|jpeg|png|webp|gif|bmp|svg)(\?\S*)?$/i.test(text.trim());
}

function buildCenteredImage(url: string): string {
  return `<div style="text-align:center;"><img src="${escapeHtml(url)}" alt="" /></div>`;
}

function tokenizeLinkedText(text: string, linkedProducts: LinkedProduct[]): TextToken[] {
  let tokens: TextToken[] = [{ type: "text", value: text }];

  const sortedProducts = [...linkedProducts]
    .filter((product) => product.title.trim().length > 0)
    .sort((left, right) => right.title.length - left.title.length);

  for (const product of sortedProducts) {
    const nextTokens: TextToken[] = [];
    const pattern = new RegExp(escapeRegExp(product.title), "giu");

    for (const token of tokens) {
      if (token.type !== "text") {
        nextTokens.push(token);
        continue;
      }

      let lastIndex = 0;
      let match = pattern.exec(token.value);
      while (match) {
        if (match.index > lastIndex) {
          nextTokens.push({
            type: "text",
            value: token.value.slice(lastIndex, match.index)
          });
        }

        nextTokens.push({
          type: "link",
          value: match[0],
          href: product.url
        });

        lastIndex = match.index + match[0].length;
        match = pattern.exec(token.value);
      }

      if (lastIndex < token.value.length) {
        nextTokens.push({
          type: "text",
          value: token.value.slice(lastIndex)
        });
      }

    }

    tokens = nextTokens;
  }

  return tokens;
}

function renderInlineText(text: string, linkedProducts: LinkedProduct[]): string {
  const tokens = tokenizeLinkedText(text, linkedProducts);
  return tokens
    .map((token) => {
      if (token.type === "text") {
        return escapeHtml(token.value);
      }

      return `<a href="${escapeHtml(token.href)}">${escapeHtml(token.value)}</a>`;
    })
    .join("");
}

function buildTextParagraph(lines: string[], linkedProducts: LinkedProduct[]): string {
  const renderedLines = lines.map((line) => renderInlineText(line, linkedProducts));
  return renderedLines.join("<br />");
}

export function plainTextToHtml(text: string, options: PlainTextToHtmlOptions = {}): string {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) {
    return "<p></p>";
  }

  const linkedProducts = options.linkedProducts ?? [];
  const blocks: string[] = [];
  const textBuffer: string[] = [];
  const lines = normalized.split("\n");
  let pendingSpacer = false;

  const flushTextBuffer = (): void => {
    if (textBuffer.length === 0) {
      return;
    }

    blocks.push(buildTextParagraph(textBuffer, linkedProducts));
    textBuffer.length = 0;
  };

  for (const line of lines) {
    const trimmedLine = line.trim();

    if (!trimmedLine) {
      flushTextBuffer();
      if (blocks.length > 0) {
        pendingSpacer = true;
      }
      continue;
    }

    if (options.embedDirectImageLinks && isDirectImageUrl(trimmedLine)) {
      flushTextBuffer();
      if (pendingSpacer) {
        pendingSpacer = false;
      }
      blocks.push(buildCenteredImage(trimmedLine));
      continue;
    }

    textBuffer.push(line);
  }

  flushTextBuffer();

  const outputBlocks: string[] = [];

  for (const block of blocks) {
    if (outputBlocks.length > 0) {
      outputBlocks.push(PARAGRAPH_SPACER);
    }

    outputBlocks.push(block);
  }

  return outputBlocks.join("");
}

export function prependImageUrlToHtml(contentHtml: string, imageUrl: string): string {
  const featureImageHtml = `<div style="text-align:center;"><img src="${escapeHtml(imageUrl)}" alt="Feature image" /></div>`;
  return `${featureImageHtml}${PARAGRAPH_SPACER}${contentHtml}`;
}
