export type SessionState =
  | "idle"
  | "waiting_title"
  | "waiting_content"
  | "waiting_image"
  | "waiting_confirmation";

export type PostSession = {
  state: SessionState;
  title?: string;
  content?: string;
  imageBase64?: string;
  imageMimeType?: string;
};
