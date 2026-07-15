/**
 * Detect whether input text contains Chinese (Han) characters.
 * Any Han character means the text is treated as Chinese — mixed input like
 * "what does 把 mean" is almost always a question about the Chinese part.
 * Covers CJK Unified Ideographs, Extension A, and compatibility ideographs.
 */
export function containsChinese(text: string): boolean {
  return /[㐀-䶿一-鿿豈-﫿]/.test(text);
}
