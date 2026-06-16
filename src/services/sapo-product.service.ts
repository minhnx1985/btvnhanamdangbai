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
  body_html?: string;
  bodyHtml?: string;
  description?: string;
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

type ProductUpdateResponse = {
  product?: RawSapoProduct;
};

class SapoProductService {
  private readonly client: AxiosInstance;
  private readonly descriptionFieldCache = new Map<string, "body_html" | "description">();

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
      const response = await this.client.get<ProductListResponse>(`/admin/products.json?alias=${encodeURIComponent(alias)}`);
      const products = normalizeProductList(response.data);
      const product = products.find((item) => getProductAlias(item) === alias) ?? products[0];

      if (!product) {
        logger.warn("sapo_product_not_found", { alias });
        return null;
      }

      logger.info("sapo_product_found", { productId: product.id, alias });
      if (product.id) {
        this.descriptionFieldCache.set(String(product.id), getDescriptionField(product));
      }
      return normalizeProduct(product);
    } catch (error) {
      throw mapSapoProductError(error);
    }
  }

  async updateProductDescription(productId: string | number, html: string): Promise<void> {
    const descriptionField = this.descriptionFieldCache.get(String(productId)) ?? "body_html";
    try {
      await this.client.put<ProductUpdateResponse>(`/admin/products/${productId}.json`, {
        product: {
          id: productId,
          [descriptionField]: html
        }
      });
    } catch (error) {
      throw mapSapoProductError(error);
    }
  }

  async updateProductSeoFields(
    _productId: string | number,
    _seo: { seoTitle: string; metaDescription: string }
  ): Promise<{ updated: boolean; reason?: string }> {
    return {
      updated: false,
      reason: "Chưa xác định chắc field SEO trong Sapo API. Hiện chưa cập nhật SEO fields."
    };
  }

  async updateProductDescriptionAndSeo(
    productId: string | number,
    payload: { html: string; seoTitle: string; metaDescription: string }
  ): Promise<{ descriptionUpdated: boolean; seoUpdated: boolean; reason?: string }> {
    await this.updateProductDescription(productId, payload.html);
    const seoResult = await this.updateProductSeoFields(productId, {
      seoTitle: payload.seoTitle,
      metaDescription: payload.metaDescription
    });

    return {
      descriptionUpdated: true,
      seoUpdated: seoResult.updated,
      reason: seoResult.reason
    };
  }
}

function mapSapoProductError(error: unknown): AppError {
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
    bodyHtml: product.body_html ?? product.bodyHtml,
    description: product.description,
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

function getDescriptionField(product: RawSapoProduct): "body_html" | "description" {
  if (typeof product.body_html === "string" || typeof product.bodyHtml === "string") {
    return "body_html";
  }

  if (typeof product.description === "string") {
    return "description";
  }

  return "body_html";
}

export const sapoProductService = new SapoProductService();
