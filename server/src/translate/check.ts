// The number check on every translated string (SPEC section 6 step 11): the
// digit sequences, currency symbols and percent signs of the output must be the
// same as the input's, in any order. Devanagari digits do not count as digits,
// so "१०" for "10" is a mismatch, as is a dropped "₹" or a spelled-out number.

/** ASCII digit runs, then every currency symbol and percent sign, sorted. */
export function protectedTokens(text: string): string[] {
  const digits = text.match(/[0-9]+/g) ?? [];
  const symbols = text.match(/[\p{Sc}%]/gu) ?? [];
  return [...digits, ...symbols].sort();
}

export function keepsNumbers(input: string, output: string): boolean {
  const a = protectedTokens(input);
  const b = protectedTokens(output);
  return a.length === b.length && a.every((token, i) => token === b[i]);
}
