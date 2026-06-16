import axios, { AxiosInstance } from "axios";
import { config } from "../config/env";
import { NormalizedSapoProduct } from "../types/product-seo.types";
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
  }

  async updateProductDescription(productId: string | number, html: string): Promise<void> {
    const descriptionField = this.descriptionFieldCache.get(String(productId)) ?? "body_html";
    await this.client.put<ProductUpdateResponse>(`/admin/products/${productId}.json`, {
      product: {
        id: productId,
        [descriptionField]: html
      }
    });
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
