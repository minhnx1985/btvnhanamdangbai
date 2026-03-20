export type SapoBlog = {
  id: number;
  title: string;
  name?: string;
};

export type CreateDraftArticleInput = {
  title: string;
  content: string;
  imageBase64: string;
  imageMimeType: string;
  tags?: string;
  blogName?: string;
  templateLayout?: string;
  prependFeatureImageInContent?: boolean;
};

export type CreateDraftArticleResult = {
  id: number | string;
  title: string;
  imageSrc?: string;
};

export type SapoProduct = {
  id: number | string;
  alias?: string;
  variants?: Array<{
    sku?: string | null;
  }>;
};
