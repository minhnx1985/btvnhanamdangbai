import axios, { AxiosInstance } from "axios";
import { config } from "../config/env";
import { AppError } from "../utils/errors";
import { logger } from "../utils/logger";

type ChatMessage = {
  role: "system" | "user";
  content: string;
};

type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
};

const ALLOWED_HTML_TAGS = new Set(["h2", "h3", "p", "strong", "em", "blockquote", "ul", "ol", "li"]);

class ShopApiService {
  private readonly client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: config.shopApiBaseUrl,
      timeout: 60000,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json"
      }
    });
  }

  async formatContentHtml(input: { title: string; content: string }): Promise<string> {
    this.ensureConfigured();

    const html = await this.createChatCompletion([
      {
        role: "system",
        content: [
          "Bạn là công cụ format HTML bảo toàn nội dung tiếng Việt.",
          "Chỉ thêm các thẻ HTML sau: h2, h3, p, strong, em, blockquote, ul, ol, li.",
          "Được chia đoạn nếu văn bản đã có dấu xuống dòng hợp lý.",
          "Được tạo heading từ chính câu hoặc cụm từ có sẵn trong văn bản.",
          "Được in đậm hoặc in nghiêng các cụm từ quan trọng.",
          "Không viết lại câu.",
          "Không thêm ý.",
          "Không xóa ý.",
          "Không đổi thứ tự.",
          "Không thay từ đồng nghĩa.",
          "Không sửa văn phong.",
          "Không tự đặt heading mới nếu heading đó không lấy từ nguyên văn hoặc gần như nguyên văn trong văn bản.",
          "Chỉ trả về HTML fragment, không markdown, không giải thích."
        ].join("\n")
      },
      {
        role: "user",
        content: [
          `Tiêu đề: ${input.title}`,
          "",
          "Nội dung cần format:",
          input.content
        ].join("\n")
      }
    ]);

    const sanitizedHtml = sanitizeAllowedHtml(html);
    if (!hasSameTextContent(input.content, sanitizedHtml)) {
      logger.error("ShopAPI formatted content failed text-preservation check", {
        originalLength: input.content.length,
        htmlLength: sanitizedHtml.length
      });
      throw new AppError("AI format đã thay đổi nội dung, vui lòng thử lại hoặc chọn KHONG", "AI_FORMAT_CHANGED_TEXT");
    }

    return sanitizedHtml;
  }

  async generateKeywordTags(input: { title: string; content: string; limit?: number }): Promise<string[]> {
    this.ensureConfigured();

    const raw = await this.createChatCompletion([
      {
        role: "system",
        content: [
          "Bạn là công cụ tạo từ khóa SEO tiếng Việt cho bài viết.",
          "Chỉ trích xuất từ khóa dựa trên nội dung có sẵn.",
          "Không thêm chủ đề không xuất hiện hoặc không được suy ra trực tiếp từ bài.",
          "Trả về JSON hợp lệ dạng {\"keywords\":[\"...\"]}.",
          "Không markdown, không giải thích."
        ].join("\n")
      },
      {
        role: "user",
        content: [
          `Tạo tối đa ${input.limit ?? 8} từ khóa cho bài viết này.`,
          `Tiêu đề: ${input.title}`,
          "",
          input.content
        ].join("\n")
      }
    ]);

    return parseKeywordResponse(raw, input.limit ?? 8);
  }

  private ensureConfigured(): void {
    if (!config.shopApiKey) {
      throw new AppError("Thiếu SHOPAPI_API_KEY để dùng AI", "SHOPAPI_API_KEY_MISSING");
    }
  }

  private async createChatCompletion(messages: ChatMessage[]): Promise<string> {
    try {
      const response = await this.client.post<ChatCompletionResponse>(
        "/chat/completions",
        {
          model: config.shopApiModel,
          messages,
          temperature: 0.1
        },
        {
          headers: {
            Authorization: `Bearer ${config.shopApiKey}`
          }
        }
      );

      const content = response.data.choices?.[0]?.message?.content?.trim();
      if (!content) {
        throw new AppError("ShopAPI không trả nội dung", "SHOPAPI_EMPTY_RESPONSE");
      }

      return stripCodeFence(content);
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }

      const reason = error instanceof Error ? error.message : "Unknown ShopAPI error";
      logger.error("ShopAPI request failed", { reason });
      throw new AppError("Không gọi được ShopAPI", "SHOPAPI_REQUEST_FAILED");
    }
  }
}

function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  const match = trimmed.match(/^```(?:html|json)?\s*([\s\S]*?)\s*```$/i);
  return match ? match[1].trim() : trimmed;
}

function sanitizeAllowedHtml(html: string): string {
  const withoutComments = html.replace(/<!--[\s\S]*?-->/g, "");
  return withoutComments.replace(/<\/?([a-zA-Z][a-zA-Z0-9-]*)(?:\s[^>]*)?>/g, (fullTag, tagName: string) => {
    const normalizedTag = tagName.toLowerCase();
    if (!ALLOWED_HTML_TAGS.has(normalizedTag)) {
      return "";
    }

    return fullTag.startsWith("</") ? `</${normalizedTag}>` : `<${normalizedTag}>`;
  });
}

function htmlToPlainText(html: string): string {
  return html
    .replace(/<\/(h2|h3|p|blockquote|li)>/gi, "\n")
    .replace(/<li>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");
}

function normalizeComparableText(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n+/g, "\n")
    .trim();
}

function hasSameTextContent(originalText: string, html: string): boolean {
  return normalizeComparableText(originalText) === normalizeComparableText(htmlToPlainText(html));
}

function parseKeywordResponse(raw: string, limit: number): string[] {
  try {
    const parsed = JSON.parse(raw) as { keywords?: unknown };
    if (!Array.isArray(parsed.keywords)) {
      return [];
    }

    return parsed.keywords
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter(Boolean)
      .slice(0, limit);
  } catch {
    return raw
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, limit);
  }
}

export const shopApiService = new ShopApiService();
