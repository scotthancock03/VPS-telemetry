export function formatTransferSize(kb: number): string {
  if (!Number.isFinite(kb)) return "0 KB";
  if (kb >= 1024) {
    return `${(kb / 1024).toFixed(2)} MB`;
  }
  return `${kb.toFixed(2)} KB`;
}