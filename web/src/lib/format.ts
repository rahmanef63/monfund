import { formatEther } from "viem";

/** Trim a MON amount to a readable number of decimals without losing precision silently. */
export function formatMon(wei: bigint, maxDecimals = 4): string {
  const s = formatEther(wei);
  if (!s.includes(".")) return s;
  const [whole, frac] = s.split(".");
  const trimmed = frac.slice(0, maxDecimals).replace(/0+$/, "");
  if (trimmed) return `${whole}.${trimmed}`;
  // A non-zero amount that is smaller than the display precision must never render
  // as a flat "0" — this string is the Amount the confirm dialog shows before signing.
  if (wei > 0n && whole === "0") return `<0.${"0".repeat(maxDecimals - 1)}1`;
  return whole;
}

/**
 * Onchain strings are attacker-controlled. React escapes markup, but Unicode
 * control (Cc) and format (Cf) characters survive escaping: a single U+202E in a
 * description reverses every character rendered after it, including our own labels.
 * Strip both classes before any onchain text reaches the DOM.
 *
 * U+200D (zero-width joiner) is the single carve-out: it is in Cf but has no
 * directional or control semantics — it is what holds a multi-person or profession
 * emoji together, so stripping it shatters one glyph into its components. Every
 * bidi character (U+061C, U+200E/200F, U+202A-202E, U+2066-2069) stays stripped.
 */
export function sanitizeOnchainText(s: string): string {
  return s.replace(/[\p{Cc}\p{Cf}]/gu, (c) => (c === "\u200D" ? c : ""));
}

/** Exact remaining time, down to the second — never rounded up into "about a day". */
export function formatDuration(totalSeconds: bigint | number): string {
  let s = typeof totalSeconds === "bigint" ? Number(totalSeconds) : totalSeconds;
  if (s <= 0) return "0s";

  const d = Math.floor(s / 86400);
  s -= d * 86400;
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  s -= m * 60;

  const parts: string[] = [];
  if (d) parts.push(`${d}d`);
  if (h || d) parts.push(`${h}h`);
  if (m || h || d) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(" ");
}

export function formatDeadline(unix: bigint): string {
  return new Date(Number(unix) * 1000).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function shortAddress(a?: string): string {
  if (!a) return "";
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

/** Basis points -> percentage string, uncapped (overfunded raises can exceed 100%). */
export function bpsToPercent(bps: bigint, decimals = 2): string {
  const pct = Number(bps) / 100;
  return `${pct.toFixed(decimals).replace(/\.?0+$/, "")}%`;
}

/** Progress bar width, clamped at 100 even when a raise is overfunded. */
export function clampedProgress(bps: bigint): number {
  return Math.min(100, Number(bps) / 100);
}
