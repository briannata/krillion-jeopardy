/**
 * Shared normalization for answer matching. Kept in its own module because both the
 * dataset builder (which bakes `key` into every stored answer) and the live matcher
 * must agree exactly — if these ever drift, every lookup silently misses.
 *
 * Conservative on purpose: strips case, accents, punctuation and a leading article,
 * but never stems, so "cell" cannot collapse into "cello".
 */
export function normalize(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/^(the|a|an)\s+/, "")
    .replace(/\s+/g, " ");
}
