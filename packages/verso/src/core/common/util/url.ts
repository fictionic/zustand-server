export function routableUrl(urlString: string): string {
  const urlObj = new URL(urlString);
  return urlObj.pathname + urlObj.search;
}
