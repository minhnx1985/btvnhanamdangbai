import axios, { AxiosError, AxiosInstance } from "axios";
import { config } from "../config/env";
import { CreateDraftArticleInput, CreateDraftArticleResult, SapoBlog } from "../types/sapo";
import { AppError } from "../utils/errors";
import { logger } from "../utils/logger";

class SapoService {
  private readonly client: AxiosInstance;
  private cachedBlogId: number | null = null;

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

  async getDefaultBlogId(): Promise<number> {
    if (this.cachedBlogId) {
      return this.cachedBlogId;
    }

    const blogs = await this.fetchBlogs();
    const blog = blogs.find((item) => this.getBlogName(item) === config.sapoDefaultBlogName);

    if (!blog) {
      throw new AppError("Không tìm thấy blog mặc định trên Sapo", "SAPO_BLOG_NOT_FOUND");
    }

    this.cachedBlogId = blog.id;
    return blog.id;
  }

  async createDraftArticle(input: CreateDraftArticleInput): Promise<CreateDraftArticleResult> {
    let blogId = await this.getDefaultBlogId();

    try {
      return await this.createDraftArticleByBlogId(blogId, input);
    } catch (error) {
      if (this.shouldRetryWithFreshBlog(error)) {
        logger.warn("Sapo create article hit 404, refreshing cached blog id");
        this.cachedBlogId = null;
        blogId = await this.getDefaultBlogId();
        return this.createDraftArticleByBlogId(blogId, input);
      }

      throw this.mapSapoError(error);
    }
  }

  private async fetchBlogs(): Promise<SapoBlog[]> {
    try {
      const response = await this.client.get<{ blogs?: SapoBlog[]; blog?: SapoBlog[] }>("/admin/blogs.json");
      return response.data.blogs ?? response.data.blog ?? [];
    } catch (error) {
      throw this.mapSapoError(error);
    }
  }

  private getBlogName(blog: SapoBlog): string {
    return (blog.title ?? blog.name ?? "").trim();
  }

  private buildImagePayload(base64: string, mimeType: string): { base64: string } {
    const normalized = base64.startsWith("data:") ? base64 : `data:${mimeType};base64,${base64}`;
    return { base64: normalized };
  }

  private async createDraftArticleByBlogId(
    blogId: number,
    input: CreateDraftArticleInput
  ): Promise<CreateDraftArticleResult> {
    try {
      const response = await this.client.post<{ article: { id: number | string; title: string } }>(
        `/admin/blogs/${blogId}/articles.json`,
        {
          article: {
            title: input.title,
            content: input.content,
            published_on: null,
            image: this.buildImagePayload(input.imageBase64, input.imageMimeType)
          }
        }
      );

      return {
        id: response.data.article.id,
        title: response.data.article.title
      };
    } catch (error) {
      throw error;
    }
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
