/**
 * Does a message's text have Chinese in it? (Any UTF-16 unit in U+4E00–U+9FFF.) The chat's
 * learning tools — the menu (messageMenu.ts), the composer's Check my Chinese, word chips — only
 * apply to Chinese. Lab port: core `MessageTools.looksLikeChinese` (parity-tested).
 */
export function looksLikeChinese(text: string): boolean {
  return /[一-鿿]/.test(text);
}
