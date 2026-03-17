function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function plainTextToHtml(text: string): string {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) {
    return "<p></p>";
  }

  const paragraphs = normalized
    .split(/\n\s*\n/g)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br />")}</p>`);

  return paragraphs.join("");
}

export function prependFeatureImageToHtml(contentHtml: string, imageBase64: string, imageMimeType: string): string {
  const imageSource = imageBase64.startsWith("data:")
    ? imageBase64
    : `data:${imageMimeType};base64,${imageBase64}`;

  const featureImageHtml = `<p><img src="${imageSource}" alt="Feature image" /></p>`;
  return `${featureImageHtml}${contentHtml}`;
}
