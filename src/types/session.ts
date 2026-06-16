import { LinkedProduct } from "./sapo";

export type SessionState =
  | "idle"
  | "waiting_title"
  | "waiting_content"
  | "waiting_image"
  | "waiting_product_link"
  | "waiting_keywords"
  | "waiting_ai_format_choice";

export type PostType = "blog" | "author";

export type PostSession = {
  state: SessionState;
  postType?: PostType;
  title?: string;
  content?: string;
  imageBase64?: string;
  imageMimeType?: string;
  tags?: string;
  productTag?: string;
  linkedProducts?: LinkedProduct[];
};
