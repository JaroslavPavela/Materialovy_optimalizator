/** Stáhne text nebo bajty jako soubor. */
export function download(fileName: string, data: string | Uint8Array, type: string) {
  const url = URL.createObjectURL(
    new Blob([typeof data === 'string' ? data : new Uint8Array(data)], { type }),
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
