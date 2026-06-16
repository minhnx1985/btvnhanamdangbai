import axios, { AxiosInstance } from "axios";
import { config } from "../config/env";
import { AppError } from "../utils/errors";
import { logger } from "../utils/logger";

export type ShopApiChatMessage = {
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

  async generateJson<T>(messages: ShopApiChatMessage[]): Promise<T> {
    this.ensureConfigured();

    const raw = await this.createChatCompletion(messages);
    try {
      return JSON.parse(raw) as T;
    } catch {
      throw new AppError("AI trả JSON không hợp lệ", "AI_JSON_PARSE_FAILED");
    }
  }

  private ensureConfigured(): void {
    if (!config.shopApiKey) {
      throw new AppError("Thiếu SHOPAPI_API_KEY để dùng AI", "SHOPAPI_API_KEY_MISSING");
    }
  }

  private async createChatCompletion(messages: ShopApiChatMessage[]): Promise<string> {
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
