import { Context, MiddlewareFn } from "telegraf";
import { messages } from "./messages";
import { config } from "../config/env";
import { replySafely } from "../utils/telegram";

export const PRODUCT_EDITOR_TELEGRAM_USER_ID = 1623038607;

export function isAuthorizedUser(userId?: number): boolean {
  if (!userId) {
    return false;
  }

  if (config.allowedUserIds.length === 0) {
    return true;
  }

  return config.allowedUserIds.includes(userId);
}

export function canEditProducts(userId?: number): boolean {
  return userId === PRODUCT_EDITOR_TELEGRAM_USER_ID;
}

export function authorizedOnly(): MiddlewareFn<Context> {
  return async (ctx, next) => {
    const userId = ctx.from?.id;
    if (!isAuthorizedUser(userId)) {
      await replySafely(ctx, messages.unauthorized, { userId });
      return;
    }

    await next();
  };
}
