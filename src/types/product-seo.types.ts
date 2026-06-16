export type NormalizedSapoProduct = {
  id: string | number;
  title: string;
  alias?: string;
  handle?: string;
  bodyHtml?: string;
  description?: string;
  vendor?: string;
  productType?: string;
  tags?: string[];
  variants?: unknown[];
  images?: unknown[];
  seoTitle?: string;
  metaTitle?: string;
  seoDescription?: string;
  metaDescription?: string;
  createdAt?: string;
  updatedAt?: string;
  raw?: unknown;
};

export type ProductSeoMarketingAudit = {
  currentSeoScore: number;
  currentMarketingScore: number;
  issues: string[];
  opportunities: string[];
};

export type ProductSeoMarketingInput = {
  product: NormalizedSapoProduct;
  audit: ProductSeoMarketingAudit;
};

export type ProductSeoMarketingResult = {
  seoTitle: string;
  metaDescription: string;
  productDescriptionHtml: string;
  marketingBlocksHtml: string;
  finalBodyHtml: string;
  telegramPreview: string;
  improvedSeoScore: number;
  improvedMarketingScore: number;
  warnings: string[];
};

export type ProductSeoPendingJob = {
  type: "product_seo_marketing_update";
  jobId: string;
  userId: number;
  productId: string | number;
  productAlias: string;
  productTitle: string;
  seoTitle: string;
  metaDescription: string;
  finalBodyHtml: string;
  audit: {
    currentSeoScore: number;
    currentMarketingScore: number;
    improvedSeoScore: number;
    improvedMarketingScore: number;
    issues: string[];
    opportunities: string[];
    warnings: string[];
  };
  createdAt: number;
};
