/**
 * How long the page waits for the hosted name before answering without it.
 *
 * The whole naming chain has one budget, not one call per provider, and this
 * deadline has to be long enough for the **last** layer to answer — otherwise
 * the fallback provider is cut off by the deadline it exists for.
 *
 * Measured on this laptop (2026-11-19):
 *   Cloudflare Workers AI  1.6–2.0 s (4.7 s cold, just after a restart)
 *   OpenCode Go / DeepSeek 8.1 s, 10.2 s and 0.9 s (warm)
 *
 * The backend's own budget is `VILLAGE_VISION_TOTAL_SECS` (14 s), which fits
 * inside this 15 s with a second to spare.  A working Workers AI answer still
 * arrives in about a second, so the long wait is only paid when the earlier
 * layers failed — and when it expires, the local classifier's answer is what
 * the visitor gets.
 */
export const VISION_WAIT_MS = 15000;
