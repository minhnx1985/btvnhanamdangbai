import axios, { AxiosError, AxiosInstance } from "axios";
import { config } from "../config/env";
import {
  CreateDraftArticleInput,
  CreateDraftArticleResult,
  LinkedProduct,
  ResolvedProductLinks,
  SapoBlog,
  SapoProduct
} from "../types/sapo";
import { prependImageUrlToHtml } from "./content.service";
import { AppError } from "../utils/errors";
import { logger } from "../utils/logger";

type ArticlePayload = {
  article: {
    title: string;
    published_on: null;
    content?: string;
    tags?: string;
    template_layout?: string;
    image?: {
      base64?: string;
    };
  };
};

type SapoArticleResponse = {
  article: {
    id: number | string;
    title: string;
    content?: string;
    image?: {
      src?: string;
    };
  };
};

const productMessages = {
  invalidProductLink:
    "Link sản phẩm không hợp lệ. Vui lòng gửi đúng link dạng https://nhanam.vn/... hoặc trả lời BO QUA.",
  productLookupFailed:
    "Không tìm thấy sản phẩm từ link này. Vui lòng kiểm tra lại link https://nhanam.vn/... hoặc trả lời BO QUA."
} as const;

class SapoService {
  private readonly client: AxiosInstance;
  private readonly blogIdCache = new Map<string, number>();

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

  async getBlogIdByName(blogName: string): Promise<number> {
    const cached = this.blogIdCache.get(blogName);
    if (cached) {
      return cached;
    }

    const blogs = await this.fetchBlogs();
    const blog = blogs.find((item) => this.getBlogName(item) === blogName);

    if (!blog) {
      throw new AppError("Không tìm thấy blog mặc định trên Sapo", "SAPO_BLOG_NOT_FOUND");
    }

    this.blogIdCache.set(blogName, blog.id);
    return blog.id;
  }

  async createDraftArticle(input: CreateDraftArticleInput): Promise<CreateDraftArticleResult> {
    const blogName = input.blogName ?? config.sapoDefaultBlogName;
    let blogId = await this.getBlogIdByName(blogName);

    try {
      return await this.createDraftArticleByBlogId(blogId, input);
    } catch (error) {
      if (this.shouldRetryWithFreshBlog(error)) {
        logger.warn("Sapo create article hit 404, refreshing cached blog id", { blogName });
        this.blogIdCache.delete(blogName);
        blogId = await this.getBlogIdByName(blogName);
        return this.createDraftArticleByBlogId(blogId, input);
      }

      throw this.mapSapoError(error);
    }
  }

  async resolveProductLinks(productText: string): Promise<ResolvedProductLinks> {
    const extractedLinks = this.extractProductLinks(productText);
    if (extractedLinks.length === 0) {
      throw new AppError(productMessages.invalidProductLink, "PRODUCT_URL_INVALID");
    }

    const linkedProducts: LinkedProduct[] = [];

    for (const item of extractedLinks) {
      const product = await this.getProductByAlias(item.alias);
      linkedProducts.push({
        id: String(product.id).trim(),
        title: (product.title ?? product.name ?? item.alias).trim(),
        url: item.url
      });
    }

    return {
      tag: `Sản phẩm ${linkedProducts.map((product) => product.id).join("_")}`,
      linkedProducts
    };
  }

  private async fetchBlogs(): Promise<SapoBlog[]> {
    try {
      const response = await this.client.get<{ blogs?: SapoBlog[]; blog?: SapoBlog[] }>("/admin/blogs.json");
      return response.data.blogs ?? response.data.blog ?? [];
    } catch (error) {
      throw this.mapSapoError(error);
    }
  }

  private async getProductByAlias(alias: string): Promise<SapoProduct> {
    try {
      const response = await this.client.get<{ products?: SapoProduct[] }>(
        `/admin/products.json?alias=${encodeURIComponent(alias)}`
      );
      const product = response.data.products?.find((item) => item.alias === alias) ?? response.data.products?.[0];

      if (!product) {
        throw new AppError(productMessages.productLookupFailed, "PRODUCT_NOT_FOUND");
      }

      return product;
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }

      throw this.mapSapoError(error);
    }
  }

  private extractProductLinks(productText: string): Array<{ alias: string; url: string }> {
    const matches = productText.match(/https?:\/\/[^\s]+/g) ?? [];
    const allowedHosts = new Set([config.sapoProductUrlHost, `www.${config.sapoProductUrlHost}`]);
    const seenAliases = new Set<string>();
    const extracted: Array<{ alias: string; url: string }> = [];

    for (const match of matches) {
      let url: URL;

      try {
        url = new URL(match);
      } catch {
        continue;
      }

      if (!allowedHosts.has(url.hostname.toLowerCase())) {
        continue;
      }

      const pathSegments = url.pathname
        .split("/")
        .map((segment) => segment.trim())
        .filter(Boolean);
      const alias = pathSegments[pathSegments.length - 1];

      if (!alias || seenAliases.has(alias)) {
        continue;
      }

      seenAliases.add(alias);
      extracted.push({
        alias,
        url: url.toString()
      });
    }

    return extracted;
  }

  private getBlogName(blog: SapoBlog): string {
    return (blog.title ?? blog.name ?? "").trim();
  }

  private buildImageWithRawBase64(base64: string): { base64: string } {
    return { base64 };
  }

  private buildCreatePayload(input: CreateDraftArticleInput): ArticlePayload {
    return {
      article: {
        title: input.title,
        content: input.content,
        tags: input.tags,
        template_layout: input.templateLayout,
        published_on: null
      }
    };
  }

  private buildUpdatePayload(content: string, imageBase64: string, input: CreateDraftArticleInput): ArticlePayload {
    return {
      article: {
        title: input.title,
        content,
        tags: input.tags,
        template_layout: input.templateLayout,
        published_on: null,
        image: this.buildImageWithRawBase64(imageBase64)
      }
    };
  }

  private async createDraftArticleByBlogId(
    blogId: number,
    input: CreateDraftArticleInput
  ): Promise<CreateDraftArticleResult> {
    const createdArticle = await this.createArticleRecord(blogId, input);
    const updatedArticle = await this.attachFeatureImage(blogId, createdArticle.id, input, createdArticle.image?.src);
    const imageSrc = updatedArticle.image?.src ?? createdArticle.image?.src;

    if (imageSrc && input.prependFeatureImageInContent !== false) {
      await this.updateArticleContentWithFeatureImage(blogId, createdArticle.id, input, imageSrc);
    }

    return {
      id: createdArticle.id,
      title: createdArticle.title,
      imageSrc
    };
  }

  private async createArticleRecord(blogId: number, input: CreateDraftArticleInput): Promise<SapoArticleResponse["article"]> {
    const response = await this.client.post<SapoArticleResponse>(
      `/admin/blogs/${blogId}/articles.json`,
      this.buildCreatePayload(input)
    );
    return response.data.article;
  }

  private async attachFeatureImage(
    blogId: number,
    articleId: number | string,
    input: CreateDraftArticleInput,
    currentImageSrc?: string
  ): Promise<SapoArticleResponse["article"]> {
    const payload = this.buildUpdatePayload(input.content, input.imageBase64, input);
    const response = await this.client.put<SapoArticleResponse>(`/admin/blogs/${blogId}/articles/${articleId}.json`, payload);

    return {
      ...response.data.article,
      image: response.data.article.image?.src ? response.data.article.image : currentImageSrc ? { src: currentImageSrc } : undefined
    };
  }

  private async updateArticleContentWithFeatureImage(
    blogId: number,
    articleId: number | string,
    input: CreateDraftArticleInput,
    imageSrc: string
  ): Promise<void> {
    await this.client.put<SapoArticleResponse>(`/admin/blogs/${blogId}/articles/${articleId}.json`, {
      article: {
        title: input.title,
        content: prependImageUrlToHtml(input.content, imageSrc),
        tags: input.tags,
        template_layout: input.templateLayout,
        published_on: null
      }
    });
  }

  private shouldRetryWithFreshBlog(error: unknown): boolean {
    return axios.isAxiosError(error) && error.response?.status === 404;
  }

  private mapSapoError(error: unknown): AppError {
    if (!axios.isAxiosError(error)) {
      return new AppError("Lỗi hệ thống, vui lòng thử lại", "SAPO_UNKNOWN_ERROR");
    }

    const status = error.response?.status;
    logger.error("Sapo response error summary", {
      status,
      url: error.config?.url,
      method: error.config?.method,
      responseData: this.summarizeResponseData(error)
    });

    if (status === 401 || status === 403) {
      return new AppError("Sapo API xác thực thất bại", "SAPO_AUTH_FAILED");
    }

    if (status === 404) {
      return new AppError("Không tìm thấy blog mặc định trên Sapo", "SAPO_NOT_FOUND");
    }

    if (status === 422) {
      return new AppError("Dữ liệu bài viết không hợp lệ", "SAPO_INVALID_DATA");
    }

    if (error.code === "ECONNABORTED" || !error.response) {
      return new AppError("Không kết nối được tới Sapo", "SAPO_NETWORK_ERROR");
    }

    return new AppError("Sapo API trả lỗi không xác định", "SAPO_UNKNOWN_ERROR");
  }

  private summarizeResponseData(error: AxiosError): unknown {
    const data = error.response?.data;
    if (typeof data === "string") {
      return data.slice(0, 500);
    }

    return data;
  }
}

export const sapoService = new SapoService();
