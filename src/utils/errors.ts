export class AppError extends Error {
  public readonly code: string;

  constructor(message: string, code = "APP_ERROR") {
    super(message);
    this.name = "AppError";
    this.code = code;
  }
}

export class AuthorizationError extends AppError {
  constructor(message = "Bạn không có quyền sử dụng bot này.") {
    super(message, "AUTHORIZATION_ERROR");
    this.name = "AuthorizationError";
  }
}
