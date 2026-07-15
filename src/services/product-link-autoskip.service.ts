const productLinkAutoSkipTimers = new Map();

export function clearProductLinkAutoSkip(userId: number): void {
  const timer = productLinkAutoSkipTimers.get(userId);
  if (!timer) {
    return;
  }

  clearTimeout(timer);
  productLinkAutoSkipTimers.delete(userId);
}

export function scheduleProductLinkAutoSkip(
  userId: number,
  delayMs: number,
  onTimeout: () => void | Promise<void>
): void {
  clearProductLinkAutoSkip(userId);

  const timer = setTimeout(() => {
    productLinkAutoSkipTimers.delete(userId);
    void onTimeout();
  }, delayMs);

  productLinkAutoSkipTimers.set(userId, timer);
}
