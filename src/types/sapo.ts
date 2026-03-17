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
};

export type CreateDraftArticleResult = {
  id: number | string;
  title: string;
};
