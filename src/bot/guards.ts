import { Context, MiddlewareFn } from "telegraf";
import { messages } from "./messages";
import { config } from "../config/env";

export function isAuthorizedUser(userId?: number): boolean {
  if (!userId) {
    return false;
  }

  if (config.allowedUserIds.length === 0) {
    return true;
  }

  return config.allowedUserIds.includes(userId);
}

export function authorizedOnly(): MiddlewareFn<Context> {
  return async (ctx, next) => {
    const userId = ctx.from?.id;
    if (!isAuthorizedUser(userId)) {
      await ctx.reply(messages.unauthorized);
      return;
    }

    await next();
  };
}
