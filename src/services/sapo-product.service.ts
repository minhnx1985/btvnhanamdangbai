import { randomUUID } from "node:crypto";
import axios, { AxiosError, AxiosInstance } from "axios";
import { config } from "../config/env";
import { NormalizedSapoProduct } from "../types/product-seo.types";
import { AppError } from "../utils/errors";
import { logger } from "../utils/logger";

type RawSapoProduct = Record<string, unknown> & {
  id?: string | number;
  title?: string;
  name?: string;
  alias?: string;
  handle?: string;
  content?: string;
  summary?: string;
  vendor?: string;
  product_type?: string;
  productType?: string;
  tags?: string | string[];
  variants?: unknown[];
  images?: unknown[];
  seo_title?: string;
  meta_title?: string;
  seo_description?: string;
  meta_description?: string;
  created_at?: string;
  updated_at?: string;
};

type ProductListResponse = {
  products?: RawSapoProduct[];
  product?: RawSapoProduct | RawSapoProduct[];
};

type ProductResponse = {
  product?: RawSapoProduct;
};

export type ProductInspectResult = {
  product: NormalizedSapoProduct;
  contentLength: number;
  summaryLength: number;
  possibleSeoFields: Array<{ field: string; exists: boolean }>;
};

class SapoProductService {
  private readonly client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: config.sapoBaseUrl,
      timeout: 30000,
      auth: {
        username: config.sapoApiKey,
        password: config.sapoApiSecret
      },
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json"
      }
    });
  }

  async findProductByAlias(alias: string): Promise<NormalizedSapoProduct | null> {
    try {
      const candidates = await this.fetchProductCandidates(alias);
      const product = candidates.find((item) => getProductAlias(item) === alias);

      if (!product) {
        logger.warn("sapo_product_not_found", { alias });
        return null;
      }

      logger.info("sapo_product_found", {
        productId: product.id,
        title: product.title ?? product.name,
        alias: getProductAlias(product)
      });
      return normalizeProduct(product);
    } catch (error) {
      throw mapSapoProductError(error);
    }
  }

  async getProduct(productId: string | number): Promise<NormalizedSapoProduct | null> {
    try {
      const response = await this.client.get<ProductResponse>(`/admin/products/${productId}.json`);
      return response.data.product ? normalizeProduct(response.data.product) : null;
    } catch (error) {
      throw mapSapoProductError(error);
    }
  }

  async inspectProductByAlias(alias: string): Promise<ProductInspectResult | null> {
    const product = await this.findProductByAlias(alias);
    if (!product) {
      return null;
    }

    const raw = isRecord(product.raw) ? product.raw : {};
    logger.info("sapo_product_inspect_raw", {
      productId: product.id,
      alias: product.alias ?? product.handle,
      rawProduct: summarizeRawProduct(raw)
    });

    return {
      product,
      contentLength: product.content?.length ?? 0,
      summaryLength: product.summary?.length ?? 0,
      possibleSeoFields: ["seo_title", "meta_title", "seo_description", "meta_description", "page_title"].map((field) => ({
        field,
        exists: Object.prototype.hasOwnProperty.call(raw, field)
      }))
    };
  }

  async updateProductContent(
    productId: string | number,
    finalBodyHtml: string,
    marker = `<!-- seo-bot-update:${randomUUID()} -->`,
    logContext: Record<string, unknown> = {}
  ): Promise<{ marker: string }> {
    const htmlWithMarker = appendMarker(finalBodyHtml, marker);

    try {
      logger.info("sapo_product_content_update_started", { ...logContext, productId, marker });
      await this.client.put<ProductResponse>(`/admin/products/${productId}.json`, {
        product: {
          id: productId,
          content: htmlWithMarker
        }
      });
      logger.info("sapo_product_content_update_put_ok", { ...logContext, productId, marker });

      const updated = await this.getProduct(productId);
      if (!updated?.content?.includes(marker)) {
        logger.error("sapo_product_content_update_verify_failed", {
          ...logContext,
          productId,
          marker,
          contentLength: updated?.content?.length ?? 0
        });
        throw new AppError("Sapo returned OK but product.content was not changed", "SAPO_PRODUCT_CONTENT_VERIFY_FAILED");
      }

      logger.info("sapo_product_content_update_verified", {
        ...logContext,
        productId,
        marker,
        contentLength: updated.content.length
      });
      return { marker };
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      throw mapSapoProductError(error);
    }
  }

  async updateProductDescription(productId: string | number, html: string): Promise<void> {
    await this.updateProductContent(productId, html);
  }

  async updateProductSeoFields(
    _productId: string | number,
    _seo: { seoTitle: string; metaDescription: string }
  ): Promise<{ updated: boolean; reason?: string }> {
    return {
      updated: false,
      reason: "Hiện chưa xác định chắc field SEO trong Sapo Product API. Bot chưa cập nhật SEO fields."
    };
  }

  async updateProductDescriptionAndSeo(
    productId: string | number,
    payload: { html: string; seoTitle: string; metaDescription: string; marker?: string }
  ): Promise<{ descriptionUpdated: boolean; seoUpdated: boolean; reason?: string }> {
    await this.updateProductContent(productId, payload.html, payload.marker);

    return {
      descriptionUpdated: true,
      seoUpdated: false,
      reason: "Hiện chưa xác định chắc field SEO trong Sapo Product API. Bot chưa cập nhật SEO fields."
    };
  }

  async testUpdateProductContent(productId: string | number): Promise<{ marker: string }> {
    const product = await this.getProduct(productId);
    if (!product) {
      throw new AppError("Không tìm thấy sản phẩm trên Sapo", "SAPO_PRODUCT_NOT_FOUND");
    }

    const marker = `<!-- sapo-test-update:${Date.now()} -->`;
    await this.updateProductContent(productId, product.content ?? "", marker);
    return { marker };
  }

  private async fetchProductCandidates(alias: string): Promise<RawSapoProduct[]> {
    const queries = [
      `/admin/products.json?alias=${encodeURIComponent(alias)}`,
      `/admin/products.json?handle=${encodeURIComponent(alias)}`,
      `/admin/products.json?query=${encodeURIComponent(alias)}`,
      "/admin/products.json?limit=250"
    ];
    const seen = new Set<string>();
    const products: RawSapoProduct[] = [];

    for (const query of queries) {
      const response = await this.client.get<ProductListResponse>(query);
      for (const product of normalizeProductList(response.data)) {
        const key = product.id ? String(product.id) : `${getProductAlias(product) ?? ""}:${product.title ?? product.name ?? ""}`;
        if (!seen.has(key)) {
          seen.add(key);
          products.push(product);
        }
      }

      if (products.some((product) => getProductAlias(product) === alias)) {
        return products;
      }
    }

    return products;
  }
}

function appendMarker(html: string, marker: string): string {
  const trimmed = html.trim();
  return trimmed ? `${trimmed}\n${marker}` : marker;
}

function mapSapoProductError(error: unknown): AppError {
  if (error instanceof AppError) {
    return error;
  }

  if (!axios.isAxiosError(error)) {
    return new AppError("Lỗi hệ thống khi thao tác sản phẩm Sapo", "SAPO_PRODUCT_UNKNOWN_ERROR");
  }

  const status = error.response?.status;
  logger.error("Sapo product response error summary", {
    status,
    url: error.config?.url,
    method: error.config?.method,
    responseData: summarizeResponseData(error)
  });

  if (status === 401 || status === 403) {
    return new AppError(
      "Sapo API chưa có quyền cập nhật sản phẩm. Vui lòng cấp quyền ghi/cập nhật sản phẩm cho private app/API key rồi thử lại.",
      "SAPO_PRODUCT_WRITE_FORBIDDEN"
    );
  }

  if (status === 404) {
    return new AppError("Không tìm thấy sản phẩm trên Sapo", "SAPO_PRODUCT_NOT_FOUND");
  }

  if (status === 422) {
    return new AppError("Dữ liệu cập nhật sản phẩm không hợp lệ", "SAPO_PRODUCT_INVALID_DATA");
  }

  if (error.code === "ECONNABORTED" || !error.response) {
    return new AppError("Không kết nối được tới Sapo khi thao tác sản phẩm", "SAPO_PRODUCT_NETWORK_ERROR");
  }

  return new AppError("Sapo API sản phẩm trả lỗi không xác định", "SAPO_PRODUCT_UNKNOWN_ERROR");
}

function summarizeResponseData(error: AxiosError): unknown {
  const data = error.response?.data;
  if (typeof data === "string") {
    return data.slice(0, 500);
  }

  return data;
}

function normalizeProductList(data: ProductListResponse): RawSapoProduct[] {
  if (Array.isArray(data.products)) {
    return data.products;
  }

  if (Array.isArray(data.product)) {
    return data.product;
  }

  return data.product ? [data.product] : [];
}

function getProductAlias(product: RawSapoProduct): string | undefined {
  const alias = product.alias ?? product.handle;
  return typeof alias === "string" ? alias.trim() : undefined;
}

function normalizeTags(tags: string | string[] | undefined): string[] | undefined {
  if (Array.isArray(tags)) {
    return tags.map((tag) => tag.trim()).filter(Boolean);
  }

  return tags?.split(",").map((tag) => tag.trim()).filter(Boolean);
}

function normalizeProduct(product: RawSapoProduct): NormalizedSapoProduct {
  return {
    id: product.id ?? "",
    title: product.title ?? product.name ?? "",
    alias: product.alias,
    handle: product.handle,
    content: product.content,
    summary: product.summary,
    vendor: product.vendor,
    productType: product.product_type ?? product.productType,
    tags: normalizeTags(product.tags),
    variants: product.variants,
    images: product.images,
    seoTitle: product.seo_title,
    metaTitle: product.meta_title,
    seoDescription: product.seo_description,
    metaDescription: product.meta_description,
    createdAt: product.created_at,
    updatedAt: product.updated_at,
    raw: product
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function summarizeRawProduct(raw: Record<string, unknown>): Record<string, unknown> {
  const summary: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string") {
      summary[key] = value.length > 500 ? `${value.slice(0, 500)}...` : value;
    } else if (Array.isArray(value)) {
      summary[key] = `[array:${value.length}]`;
    } else if (isRecord(value)) {
      summary[key] = `[object:${Object.keys(value).join(",")}]`;
    } else {
      summary[key] = value;
    }
  }
  return summary;
}

export const sapoProductService = new SapoProductService();

export async function findProductByAlias(alias: string): Promise<NormalizedSapoProduct | null> {
  return sapoProductService.findProductByAlias(alias);
}

export async function updateProductContent(productId: string | number, finalBodyHtml: string): Promise<void> {
  await sapoProductService.updateProductContent(productId, finalBodyHtml);
}
