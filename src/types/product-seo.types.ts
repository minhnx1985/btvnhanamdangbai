export type NormalizedSapoProduct = {
  id: string | number;
  title: string;
  alias?: string;
  handle?: string;
  content?: string;
  summary?: string;
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

export type BookDNA = {
  bookType: string;
  genreOrCategory: string;
  readerDNA: string;
  buyerDNA: string;
  readingExperience: string;
  corePromise: string;
  competitiveAdvantage: string;
  positioningStatement: string;
  selectedFramework: string;
  corePremise: string;
  coreAppeal: string;
  emotionalPromise: string;
  intellectualPromise: string;
  targetReaders: string[];
  buyingReasons: string[];
  sellingPoints: string[];
  authorLeverage: string;
  seriesOrBrandLeverage: string;
  comparableTitlesOrSignals: string[];
  foreignPraiseQuotes: string[];
  toneOfVoice: string;
  marketingAngle: string;
  seoKeywords: string[];
  forbiddenClaims: string[];
  missingData: string[];
  confidence: number;
};

export type ProductSeoMarketingAudit = {
  currentSeoScore: number;
  currentMarketingScore: number;
  issues: string[];
  opportunities: string[];
};

export type ProductResearchSource = {
  source: string;
  title: string;
  url?: string;
  summary: string;
};

export type ProductSeoMarketingInput = {
  product: NormalizedSapoProduct;
  audit: ProductSeoMarketingAudit;
  bookDNA: BookDNA;
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
  product: NormalizedSapoProduct;
  seoTitle: string;
  metaDescription: string;
  finalBodyHtml: string;
  bookDNA: BookDNA;
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

export type ProductSeoPreparationJob = {
  type: "product_seo_preparation";
  jobId: string;
  userId: number;
  alias: string;
  formatMode?: "replace" | "append";
  createdAt: number;
};

export type ProductSeoHumanEnrichment = {
  dataType: string;
  summary: string;
  insights: string[];
  createdAt: number;
};

export type ProductSeoBookUnderstandingJob = {
  type: "product_seo_book_understanding";
  jobId: string;
  userId: number;
  product: NormalizedSapoProduct;
  productId: string | number;
  productAlias: string;
  productTitle: string;
  bookDNA: BookDNA;
  audit: ProductSeoMarketingAudit;
  enrichments: ProductSeoHumanEnrichment[];
  createdAt: number;
};

export type HumanBookEnrichmentResult = {
  dataType: string;
  summary: string;
  insights: string[];
  updatedBookDNA: BookDNA;
};
