const HASH_BITS = 64;
const BIGINT_ONE = BigInt(1);
const HASH_MASK = (BIGINT_ONE << BigInt(HASH_BITS)) - BIGINT_ONE;
const FNV_OFFSET = BigInt("0xcbf29ce484222325");
const FNV_PRIME = BigInt("0x100000001b3");

export const SIMHASH_DEFAULT_THRESHOLD = 0.92;
export const SIMHASH_DEFAULT_WINDOW_DAYS = 90;

function fnv1a64(value: string): bigint {
  let hash = FNV_OFFSET;
  for (const byte of new TextEncoder().encode(value)) {
    hash ^= BigInt(byte);
    hash = (hash * FNV_PRIME) & HASH_MASK;
  }
  return hash;
}

/**
 * Latin text becomes word tokens. Han, Hangul, Hiragana and Katakana each
 * become character tokens, so three-token shingles preserve CJK similarity.
 */
export function similarityTokens(text: string): string[] {
  return (text.normalize("NFKC").toLowerCase().match(
    /[\p{Script=Han}\p{Script=Hangul}\p{Script=Hiragana}\p{Script=Katakana}]|[\p{L}\p{N}+#.]+/gu,
  ) ?? [])
    .map((token) => token.replace(/^\.+|\.+$/g, ""))
    .filter(Boolean);
}

export function buildSimilarityShingles(
  text: string,
  size = 3,
): string[] {
  const tokens = similarityTokens(text);
  if (!tokens.length) return [];
  const width = Math.max(1, Math.min(Math.trunc(size) || 3, 8));
  if (tokens.length < width) return tokens;

  const shingles: string[] = [];
  for (let index = 0; index <= tokens.length - width; index += 1) {
    shingles.push(tokens.slice(index, index + width).join("\u001f"));
  }
  return shingles;
}

/** JSON-safe lowercase 16-character 64-bit SimHash. */
export function computeSimHash64(text: string): string | null {
  const shingles = buildSimilarityShingles(text, 3);
  if (!shingles.length) return null;

  const vector = Array<number>(HASH_BITS).fill(0);
  for (const shingle of shingles) {
    const hash = fnv1a64(shingle);
    for (let bit = 0; bit < HASH_BITS; bit += 1) {
      vector[bit] +=
        (hash & (BIGINT_ONE << BigInt(bit))) === BigInt(0) ? -1 : 1;
    }
  }

  let fingerprint = BigInt(0);
  for (let bit = 0; bit < HASH_BITS; bit += 1) {
    if (vector[bit] > 0) fingerprint |= BIGINT_ONE << BigInt(bit);
  }
  return fingerprint.toString(16).padStart(16, "0");
}

function parseFingerprint(value: string): bigint {
  if (!/^[0-9a-f]{16}$/i.test(value)) {
    throw new Error("SimHash fingerprint must be exactly 16 hexadecimal characters");
  }
  return BigInt(`0x${value}`);
}

export function simHashHammingDistance(left: string, right: string): number {
  let differing = parseFingerprint(left) ^ parseFingerprint(right);
  let count = 0;
  while (differing) {
    differing &= differing - BIGINT_ONE;
    count += 1;
  }
  return count;
}

export function simHashSimilarity(left: string, right: string): number {
  return 1 - simHashHammingDistance(left, right) / HASH_BITS;
}

export function isNearDuplicateSimHash(
  left: string,
  right: string,
  threshold = SIMHASH_DEFAULT_THRESHOLD,
): boolean {
  const safeThreshold = Number.isFinite(threshold)
    ? Math.max(0, Math.min(threshold, 1))
    : SIMHASH_DEFAULT_THRESHOLD;
  return simHashSimilarity(left, right) >= safeThreshold;
}

export function isWithinSimHashWindow(
  leftDate: string | Date,
  rightDate: string | Date,
  windowDays = SIMHASH_DEFAULT_WINDOW_DAYS,
): boolean {
  const left = new Date(leftDate).getTime();
  const right = new Date(rightDate).getTime();
  if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
  const safeWindowDays = Number.isFinite(windowDays)
    ? Math.max(0, windowDays)
    : SIMHASH_DEFAULT_WINDOW_DAYS;
  const windowMs = safeWindowDays * 86_400_000;
  return Math.abs(left - right) <= windowMs;
}
