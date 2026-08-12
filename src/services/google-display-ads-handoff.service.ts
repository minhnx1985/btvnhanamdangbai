import axios, { AxiosInstance } from "axios";
import { config } from "../config/env";
import { logger } from "../utils/logger";

type BlogAdsHandoffInput = {
  articleId: string | number;
  title: string;
  url: string;
  blogName: string;
  tags?: string;
};

type BlogAdsHandoffResult = {
  sent: boolean;
  channel?: "webhook" | "telegram";
  reason?: string;
};

class GoogleDisplayAdsHandoffService {
  private readonly client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      timeout: 15000,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json"
      }
    });
  }

  async notifyBlogPublished(input: BlogAdsHandoffInput): Promise<BlogAdsHandoffResult> {
    if (!input.url) {
      return { sent: false, reason: "missing_article_url" };
    }

    if (config.googleDisplayAdsWebhookUrl) {
      return this.notifyWebhook(input);
    }

    if (config.googleDisplayAdsBotToken && config.googleDisplayAdsChatId) {
      return this.notifyTelegram(input);
    }

    return { sent: false, reason: "ads_handoff_not_configured" };
  }

  private async notifyWebhook(input: BlogAdsHandoffInput): Promise<BlogAdsHandoffResult> {
    try {
      await this.client.post(config.googleDisplayAdsWebhookUrl, {
        source: "telegram-sapo-bot",
        type: "blog_published",
        articleId: input.articleId,
        title: input.title,
        url: input.url,
        blogName: input.blogName,
        tags: input.tags ?? "",
        createdAt: new Date().toISOString()
      });

      logger.info("google_display_ads_handoff_sent", {
        channel: "webhook",
        articleId: input.articleId,
        url: input.url
      });
      return { sent: true, channel: "webhook" };
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Unknown webhook handoff error";
      logger.warn("google_display_ads_handoff_failed", {
        channel: "webhook",
        articleId: input.articleId,
        reason
      });
      return { sent: false, channel: "webhook", reason };
    }
  }

  private async notifyTelegram(input: BlogAdsHandoffInput): Promise<BlogAdsHandoffResult> {
    try {
      await this.client.post(`https://api.telegram.org/bot${config.googleDisplayAdsBotToken}/sendMessage`, {
        chat_id: config.googleDisplayAdsChatId,
        text: buildTelegramMessage(input),
        disable_web_page_preview: false
      });

      logger.info("google_display_ads_handoff_sent", {
        channel: "telegram",
        articleId: input.articleId,
        url: input.url
      });
      return { sent: true, channel: "telegram" };
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Unknown Telegram handoff error";
      logger.warn("google_display_ads_handoff_failed", {
        channel: "telegram",
        articleId: input.articleId,
        reason
      });
      return { sent: false, channel: "telegram", reason };
    }
  }
}

function buildTelegramMessage(input: BlogAdsHandoffInput): string {
  return [
    "BLOG_PUBLISHED",
    `Title: ${input.title}`,
    `URL: ${input.url}`,
    `Article ID: ${input.articleId}`,
    `Blog: ${input.blogName}`,
    input.tags ? `Tags: ${input.tags}` : ""
  ]
    .filter(Boolean)
    .join("\n");
}

export const googleDisplayAdsHandoffService = new GoogleDisplayAdsHandoffService();
