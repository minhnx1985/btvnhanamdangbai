import { Context, Telegraf } from "telegraf";
import { config } from "../config/env";
import { authorizedOnly, isAuthorizedUser } from "./guards";
import { messages } from "./messages";
import { handleAuthor } from "../handlers/author.handler";
import { handleBlog } from "../handlers/blog.handler";
import { handleCancel } from "../handlers/cancel.handler";
import { handleNewPost } from "../handlers/newpost.handler";
import { handlePhotoMessage } from "../handlers/photo.handler";
import { handleNormalizeProductTitleCommand, handleProductTitleCallback } from "../handlers/product-title.handler";
import {
  handleInspectProductCommand,
  handleProductSeoCallback,
  handleSeoCommand,
  handleTestUpdateCommand
} from "../handlers/product-seo.handler";
import { handleStart } from "../handlers/start.handler";
import { handleTextMessage } from "../handlers/text.handler";
import { getSession } from "./sessionStore";
import { replySafely } from "../utils/telegram";

function isTextMessage(ctx: Context): ctx is Context & { message: { text: string } } {
  return "message" in ctx && !!ctx.message && "text" in ctx.message;
}

function isPhotoMessage(ctx: Context): ctx is Context & {
  message: {
    photo: Array<{ file_id: string; file_unique_id: string; width: number; height: number; file_size?: number }>;
  };
} {
  return "message" in ctx && !!ctx.message && "photo" in ctx.message;
}

export function createBot(): Telegraf<Context> {
  const bot = new Telegraf<Context>(config.telegramBotToken, {
    handlerTimeout: 5 * 60 * 1000
  });

  bot.use(authorizedOnly());

  bot.start(handleStart);
  bot.command("newpost", handleNewPost);
  bot.command("blog", handleBlog);
  bot.command("author", handleAuthor);
  bot.command("cancel", handleCancel);
  bot.command("seo", handleSeoCommand);
  bot.command("s", handleNormalizeProductTitleCommand);
  bot.command("inspectproduct", handleInspectProductCommand);
  bot.command("testupdate", handleTestUpdateCommand);
  bot.on("callback_query", async (ctx) => {
    if (await handleProductTitleCallback(ctx)) {
      return;
    }

    await handleProductSeoCallback(ctx);
  });

  bot.on("text", async (ctx) => {
    if (!isAuthorizedUser(ctx.from?.id)) {
      await replySafely(ctx, messages.unauthorized, { userId: ctx.from?.id });
      return;
    }

    await handleTextMessage(ctx);
  });

  bot.on("photo", async (ctx) => {
    if (!isAuthorizedUser(ctx.from?.id)) {
      await replySafely(ctx, messages.unauthorized, { userId: ctx.from?.id });
      return;
    }

    await handlePhotoMessage(ctx);
  });

  bot.on("message", async (ctx) => {
    const userId = ctx.from?.id;
    const session = userId ? getSession(userId) : { state: "idle" as const };

    if (isTextMessage(ctx) || isPhotoMessage(ctx)) {
      return;
    }

    if (session.state === "waiting_title") {
      await replySafely(ctx, messages.waitTitleText, { userId });
      return;
    }

    if (session.state === "waiting_content") {
      await replySafely(ctx, messages.waitContentText, { userId });
      return;
    }

    if (session.state === "waiting_image") {
      await replySafely(ctx, messages.waitImagePhoto, { userId });
      return;
    }

    if (session.state === "waiting_product_link") {
      await replySafely(ctx, messages.waitProductLinkText, { userId });
      return;
    }

    if (session.state === "waiting_keywords") {
      await replySafely(ctx, messages.waitKeywordsText, { userId });
      return;
    }

    await replySafely(ctx, messages.genericStartFlow, { userId });
  });

  return bot;
}
