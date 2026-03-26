type PlainTextToHtmlOptions = {
  embedDirectImageLinks?: boolean;
};

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function isDirectImageUrl(text: string): boolean {
  return /^https?:\/\/\S+\.(jpg|jpeg|png|webp|gif|bmp|svg)(\?\S*)?$/i.test(text.trim());
}

function buildTextParagraph(lines: string[]): string {
  return `<p>${escapeHtml(lines.join("\n")).replace(/\n/g, "<br />")}</p>`;
}

function buildCenteredImage(url: string): string {
  return `<p style="text-align:center;"><img src="${escapeHtml(url)}" alt="" /></p>`;
}

export function plainTextToHtml(text: string, options: PlainTextToHtmlOptions = {}): string {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) {
    return "<p></p>";
  }

  const blocks: string[] = [];
  const textBuffer: string[] = [];
  const lines = normalized.split("\n");

  const flushTextBuffer = (): void => {
    if (textBuffer.length === 0) {
      return;
    }

    blocks.push(buildTextParagraph(textBuffer));
    textBuffer.length = 0;
  };

  for (const line of lines) {
    const trimmedLine = line.trim();

    if (!trimmedLine) {
      flushTextBuffer();
      continue;
    }

    if (options.embedDirectImageLinks && isDirectImageUrl(trimmedLine)) {
      flushTextBuffer();
      blocks.push(buildCenteredImage(trimmedLine));
      continue;
    }

    textBuffer.push(line);
  }

  flushTextBuffer();

  return blocks.join("");
}

export function prependImageUrlToHtml(contentHtml: string, imageUrl: string): string {
  const featureImageHtml = `<p style="text-align:center;"><img src="${escapeHtml(imageUrl)}" alt="Feature image" /></p>`;
  return `${featureImageHtml}${contentHtml}`;
}
