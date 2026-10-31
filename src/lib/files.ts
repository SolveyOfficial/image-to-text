export interface InputFile {
  name: string;
  type: string;
  bytes: Uint8Array;
}

export const readFile = async (file: File): Promise<InputFile> => ({
  name: file.name,
  type: file.type,
  bytes: new Uint8Array(await file.arrayBuffer()),
});

export const isPdf = (file: Pick<InputFile, "name" | "type">) =>
  file.type === "application/pdf" || /\.pdf$/i.test(file.name);

export const isImage = (file: Pick<InputFile, "name" | "type">) =>
  file.type.startsWith("image/") ||
  /\.(jpe?g|png|webp|gif|bmp|avif|tiff?)$/i.test(file.name);

/** "scan.pdf" with suffix "text" and extension "txt" becomes "scan-text.txt". */
export const outputName = (name: string, suffix: string, extension: string) =>
  `${name.replace(/\.[^.]+$/, "") || "document"}-${suffix}.${extension}`;

/** Formats a byte count for people, e.g. "1.2 MB". */
export const formatBytes = (bytes: number) => {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

/** Saves bytes as a file in the user's downloads. */
export const download = (
  bytes: Uint8Array | Blob | string,
  name: string,
  type: string,
) => {
  const blob = bytes instanceof Blob ? bytes : new Blob([bytes as BlobPart], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
};
