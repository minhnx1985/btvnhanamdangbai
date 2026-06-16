import axios from "axios";
import { Context } from "telegraf";
import { config } from "../config/env";
import { AppError } from "../utils/errors";
import { logger } from "../utils/logger";

type PhotoContext = Context & {
  message: {
    photo?: Array<{ file_id: string; file_unique_id: string; width: number; height: number; file_size?: number }>;
  };
};

const MAX_TELEGRAM_FILE_ATTEMPTS = 3;
const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function getErrorStatus(error: unknown): number | undefined {
  if (axios.isAxiosError(error)) {
    return error.response?.status;
  }

  if (error && typeof error === "object" && "response" in error) {
    const response = (error as { response?: { error_code?: unknown } }).response;
    return typeof response?.error_code === "number" ? response.error_code : undefined;
  }

  return undefined;
}

function isRetryableTelegramError(error: unknown): boolean {
  if (axios.isAxiosError(error)) {
    return !error.response || RETRYABLE_STATUS_CODES.has(error.response.status);
  }

  const status = getErrorStatus(error);
  if (status && RETRYABLE_STATUS_CODES.has(status)) {
    return true;
  }

  const message = error instanceof Error ? error.message : "";
  return /(?:gateway time-out|timeout|econnreset|etimedout)/i.test(message);
}

async function withTelegramFileRetry<T>(operation: () => Promise<T>, label: string): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_TELEGRAM_FILE_ATTEMPTS; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      if (attempt >= MAX_TELEGRAM_FILE_ATTEMPTS || !isRetryableTelegramError(error)) {
        break;
      }

      const delayMs = attempt * 750;
      const reason = error instanceof Error ? error.message : "Unknown Telegram file error";
      logger.warn("Telegram file operation retrying", { label, attempt, delayMs, reason });
      await sleep(delayMs);
    }
  }

  throw lastError;
}

export async function downloadTelegramPhoto(ctx: PhotoContext): Promise<Buffer> {
  const photos = ctx.message.photo;
  const largestPhoto = photos?.[photos.length - 1];

  if (!largestPhoto) {
    throw new AppError("Không tải được ảnh từ Telegram", "TELEGRAM_FILE_NOT_FOUND");
  }

  const file = await withTelegramFileRetry(() => ctx.telegram.getFile(largestPhoto.file_id), "getFile");
  if (!file.file_path) {
    throw new AppError("Không tải được ảnh từ Telegram", "TELEGRAM_FILE_PATH_MISSING");
  }

  const fileUrl = `https://api.telegram.org/file/bot${config.telegramBotToken}/${file.file_path}`;
  const response = await withTelegramFileRetry(
    () =>
      axios.get<ArrayBuffer>(fileUrl, {
        responseType: "arraybuffer",
        timeout: 30000
      }),
    "downloadFile"
  );

  return Buffer.from(response.data);
}
