import axios from "axios";
import { Context } from "telegraf";
import { config } from "../config/env";
import { AppError } from "../utils/errors";

type PhotoContext = Context & {
  message: {
    photo?: Array<{ file_id: string; file_unique_id: string; width: number; height: number; file_size?: number }>;
  };
};

export async function downloadTelegramPhoto(ctx: PhotoContext): Promise<Buffer> {
  const photos = ctx.message.photo;
  const largestPhoto = photos?.[photos.length - 1];

  if (!largestPhoto) {
    throw new AppError("Không tải được ảnh từ Telegram", "TELEGRAM_FILE_NOT_FOUND");
  }

  const file = await ctx.telegram.getFile(largestPhoto.file_id);
  if (!file.file_path) {
    throw new AppError("Không tải được ảnh từ Telegram", "TELEGRAM_FILE_PATH_MISSING");
  }

  const fileUrl = `https://api.telegram.org/file/bot${config.telegramBotToken}/${file.file_path}`;
  const response = await axios.get<ArrayBuffer>(fileUrl, {
    responseType: "arraybuffer",
    timeout: 30000
  });

  return Buffer.from(response.data);
}
