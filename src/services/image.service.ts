import sharp from "sharp";
import { AppError } from "../utils/errors";

const ONE_MB_IN_BYTES = 1024 * 1024;
const QUALITY_STEPS = [80, 75, 70, 65, 60, 55];
const WIDTH_STEPS = [1600, 1400, 1200, 1000];
const MAX_ATTEMPTS = 10;

export async function compressImageUnder1MB(inputBuffer: Buffer): Promise<{
  base64: string;
  mimeType: "image/jpeg";
  sizeBytes: number;
}> {
  const metadata = await sharp(inputBuffer).metadata();
  const originalWidth = metadata.width ?? WIDTH_STEPS[0];
  let attempt = 0;

  for (const widthLimit of WIDTH_STEPS) {
    const width = Math.min(originalWidth, widthLimit);

    for (const quality of QUALITY_STEPS) {
      attempt += 1;

      const outputBuffer = await sharp(inputBuffer)
        .rotate()
        .resize({ width, withoutEnlargement: true })
        .jpeg({ quality, mozjpeg: true })
        .toBuffer();

      if (outputBuffer.length < ONE_MB_IN_BYTES) {
        return {
          base64: outputBuffer.toString("base64"),
          mimeType: "image/jpeg",
          sizeBytes: outputBuffer.length
        };
      }

      if (attempt >= MAX_ATTEMPTS) {
        break;
      }
    }

    if (attempt >= MAX_ATTEMPTS) {
      break;
    }
  }

  throw new AppError("Không thể xử lý ảnh dưới 1MB", "IMAGE_PROCESSING_FAILED");
}
