import { Context, Telegraf } from "telegraf";
import { config } from "../config/env";
import { authorizedOnly, isAuthorizedUser } from "./guards";
import { messages } from "./messages";
import { handleCancel } from "../handlers/cancel.handler";
import { handleNewPost } from "../handlers/newpost.handler";
import { handlePhotoMessage } from "../handlers/photo.handler";
import { handleStart } from "../handlers/start.handler";
import { handleTextMessage } from "../handlers/text.handler";
import { getSession } from "./sessionStore";

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
  const bot = new Telegraf<Context>(config.telegramBotToken);

  bot.use(authorizedOnly());

  bot.start(handleStart);
  bot.command("newpost", handleNewPost);
  bot.command("cancel", handleCancel);

  bot.on("text", async (ctx) => {
    if (!isAuthorizedUser(ctx.from?.id)) {
      await ctx.reply(messages.unauthorized);
      return;
    }

    await handleTextMessage(ctx);
  });

  bot.on("photo", async (ctx) => {
    if (!isAuthorizedUser(ctx.from?.id)) {
      await ctx.reply(messages.unauthorized);
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
      await ctx.reply(messages.waitTitleText);
      return;
    }

    if (session.state === "waiting_content") {
      await ctx.reply(messages.waitContentText);
      return;
    }

    if (session.state === "waiting_image") {
      await ctx.reply(messages.waitImagePhoto);
      return;
    }

    if (session.state === "waiting_product_link") {
      await ctx.reply(messages.waitProductLinkText);
      return;
    }

    await ctx.reply(messages.genericStartFlow);
  });

  return bot;
}
