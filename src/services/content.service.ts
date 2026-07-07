import { LinkedProduct } from "../types/sapo";
import { PostType } from "../types/session";
import { logger } from "../utils/logger";
import { shopApiService, ShopApiChatMessage } from "./shopapi.service";

type PlainTextToHtmlOptions = {
  embedDirectImageLinks?: boolean;
  linkedProducts?: LinkedProduct[];
};

type ArticleContentFormatInput = PlainTextToHtmlOptions & {
  title: string;
  content: string;
  postType: PostType;
};

type RawArticleContentFormatResult = {
  html?: unknown;
  warnings?: unknown;
};

type TextToken =
  | { type: "text"; value: string }
  | { type: "link"; value: string; href: string };

const PARAGRAPH_SPACER = "";
const FEATURE_IMAGE_SPACER = "";
const ALLOWED_ARTICLE_FORMAT_TAGS = new Set(["h1", "h2", "h3", "p", "strong", "em", "blockquote", "ul", "ol", "li", "img"]);

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
  return `<div style="line-height: 1.2; margin-bottom: 1.5em; text-align: justify;">${renderedLines.join("<br />")}</div>`;
}

export function applyReadableSpacingToHtml(html: string): string {
  return html
    .replace(/<h1>/g, `<h1 style="line-height: 1.2; margin: 1.5em 0 0.75em;">`)
    .replace(/<p style="text-align: right;">/g, `<p style="line-height: 1.2; margin-bottom: 1.5em; text-align: right;">`)
    .replace(/<p>/g, `<p style="line-height: 1.2; margin-bottom: 1.5em;">`)
    .replace(/<li>/g, `<li style="line-height: 1.2; margin-bottom: 0.5em;">`)
    .replace(/<h2>/g, `<h2 style="line-height: 1.2; margin: 1.5em 0 0.75em;">`)
    .replace(/<h3>/g, `<h3 style="line-height: 1.2; margin: 1.5em 0 0.75em;">`);
}

export async function formatArticleContentHtml(input: ArticleContentFormatInput): Promise<string> {
  try {
    const rawResult = await shopApiService.generateJson<RawArticleContentFormatResult>(buildArticleFormatMessages(input));
    const rawHtml = typeof rawResult.html === "string" ? rawResult.html.trim() : "";
    if (!rawHtml) {
      throw new Error("AI article formatter returned empty html");
    }

    const sanitizedHtml = convertStandaloneImageUrlParagraphs(sanitizeArticleFormatHtml(rawHtml));
    const spacedHtml = applyReadableSpacingToHtml(sanitizedHtml);
    return linkProductTitlesInHtml(spacedHtml, input.linkedProducts ?? []);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Unknown article format error";
    logger.warn("AI article format fallback used", { reason, postType: input.postType });
    return plainTextToHtml(input.content, {
      embedDirectImageLinks: input.embedDirectImageLinks,
      linkedProducts: input.linkedProducts
    });
  }
}

function buildArticleFormatMessages(input: ArticleContentFormatInput): ShopApiChatMessage[] {
  return [
    {
      role: "system",
      content: [
        "Bạn là trợ lý format HTML cho bài viết blog Nhã Nam.",
        "",
        "Nhiệm vụ duy nhất:",
        "- Chuyển nội dung người dùng nhập thành HTML sạch, dễ đọc.",
        "- Không viết lại câu.",
        "- Không thêm ý.",
        "- Không xóa ý.",
        "- Không đổi thứ tự ý.",
        "- Không thay từ đồng nghĩa.",
        "- Không sửa văn phong.",
        "",
        "Được phép format:",
        "- Tự nhận diện heading và dùng h1, h2, h3 đúng cấp nếu trong văn bản có dấu hiệu heading rõ ràng.",
        "- In đậm tên sách bằng strong.",
        "- In nghiêng tên tác giả bằng em.",
        "- Chuyển danh sách thành ul/ol/li nếu người dùng đã viết theo dạng danh sách hoặc từng dòng.",
        "- Nếu có URL ảnh trực tiếp (.jpg, .jpeg, .png, .webp, .gif, .bmp, .svg), chuyển URL đó thành <p><img src=\"URL\" alt=\"\" /></p> và giữ đúng vị trí.",
        "",
        "Quy tắc quote/praise:",
        "- Nếu có câu trích dẫn, lời khen, praise hoặc review dạng quote, đặt quote trong <p><em>quote text</em></p>.",
        "- Dòng nguồn quote ngay sau đó đặt thành <p style=\"text-align: right;\"><strong>Nguồn quote</strong></p>.",
        "- Không tự tạo quote hoặc nguồn quote mới.",
        "- Không tự đoán nguồn nếu text không có nguồn.",
        "",
        "HTML được dùng:",
        "- h1, h2, h3, p, strong, em, blockquote, ul, ol, li, img.",
        "- Riêng p nguồn quote được dùng style đúng y hệt: style=\"text-align: right;\".",
        "- Riêng img chỉ được dùng src là URL ảnh trực tiếp từ nội dung người dùng và alt rỗng.",
        "",
        "Không dùng:",
        "- markdown.",
        "- iframe, script, a.",
        "- class, id, data attribute.",
        "- inline style khác ngoài text-align right cho nguồn quote.",
        "",
        "Output bắt buộc là JSON hợp lệ:",
        JSON.stringify({
          html: "<p>...</p>",
          warnings: []
        }),
        "",
        "Không giải thích ngoài JSON."
      ].join("\n")
    },
    {
      role: "user",
      content: JSON.stringify({
        title: input.title,
        postType: input.postType,
        linkedProductTitles: (input.linkedProducts ?? []).map((product) => product.title),
        content: input.content
      })
    }
  ];
}

function sanitizeArticleFormatHtml(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, "")
    .replace(/<a\b[\s\S]*?>/gi, "")
    .replace(/<\/a>/gi, "")
    .replace(/<img\b[^>]*>/gi, (tag) => {
      const imageUrl = readImageSrc(tag);
      return imageUrl ? renderImageTag(imageUrl) : "";
    })
    .replace(/<\/?(?!img\b)([a-zA-Z][a-zA-Z0-9-]*)(?:\s[^>]*)?>/g, (fullTag, tagName: string) => {
      const normalizedTag = tagName.toLowerCase();
      if (!ALLOWED_ARTICLE_FORMAT_TAGS.has(normalizedTag)) {
        return "";
      }

      if (fullTag.startsWith("</")) {
        return `</${normalizedTag}>`;
      }

      if (normalizedTag === "p" && /\bstyle\s*=\s*["'][^"']*text-align\s*:\s*right\s*;?[^"']*["']/i.test(fullTag)) {
        return `<p style="text-align: right;">`;
      }

      return `<${normalizedTag}>`;
    });
}

function convertStandaloneImageUrlParagraphs(html: string): string {
  return html.replace(/<p>([\s\S]*?)<\/p>/gi, (match, innerHtml: string) => {
    const text = stripHtml(innerHtml).trim();
    return isDirectImageUrl(text) ? `<p>${renderImageTag(text)}</p>` : match;
  });
}

function readImageSrc(tag: string): string | null {
  const match = tag.match(/\bsrc\s*=\s*["']([^"']+)["']/i);
  if (!match) {
    return null;
  }

  const decodedSrc = decodeBasicHtmlEntities(match[1]).trim();
  return isDirectImageUrl(decodedSrc) ? decodedSrc : null;
}

function renderImageTag(src: string): string {
  return `<img src="${escapeHtml(src)}" alt="" />`;
}

function stripHtml(html: string): string {
  return decodeBasicHtmlEntities(html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function decodeBasicHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function linkProductTitlesInHtml(html: string, linkedProducts: LinkedProduct[]): string {
  const sortedProducts = [...linkedProducts]
    .filter((product) => product.title.trim().length > 0)
    .sort((left, right) => right.title.length - left.title.length);

  if (sortedProducts.length === 0) {
    return html;
  }

  return html
    .split(/(<[^>]+>)/g)
    .map((part) => {
      if (part.startsWith("<")) {
        return part;
      }

      return tokenizeLinkedHtmlText(part, sortedProducts)
        .map((token) => {
          if (token.type === "text") {
            return token.value;
          }

          return `<a href="${escapeHtml(token.href)}">${token.value}</a>`;
        })
        .join("");
    })
    .join("");
}

function tokenizeLinkedHtmlText(text: string, linkedProducts: LinkedProduct[]): TextToken[] {
  let tokens: TextToken[] = [{ type: "text", value: text }];

  for (const product of linkedProducts) {
    const nextTokens: TextToken[] = [];
    const pattern = new RegExp(escapeRegExp(escapeHtml(product.title)), "giu");

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
  return `${featureImageHtml}${FEATURE_IMAGE_SPACER}${contentHtml}`;
}
