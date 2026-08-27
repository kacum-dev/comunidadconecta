const DOCUMENT_MIME_TYPES = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv",
  txt: "text/plain"
} as const;

export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

export class UnsupportedDocumentFileError extends Error {
  constructor(message = "El contenido del archivo no coincide con un formato permitido.") {
    super(message);
    this.name = "UnsupportedDocumentFileError";
  }
}

function startsWith(bytes: Uint8Array, signature: number[]) {
  return signature.every((value, index) => bytes[index] === value);
}

function extensionOf(name: string) {
  const match = /\.([a-z0-9]+)$/i.exec(name.trim());
  return match?.[1].toLowerCase() ?? "";
}

function isSafeText(bytes: Uint8Array) {
  if (bytes.includes(0)) return false;
  try {
    const value = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (!value) return false;
    const controls = Array.from(value).filter((character) => {
      const code = character.charCodeAt(0);
      return code < 32 && !["\n", "\r", "\t"].includes(character);
    }).length;
    return controls / value.length < 0.01;
  } catch {
    return false;
  }
}

function officeMime(bytes: Uint8Array, extension: string) {
  if (!startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) return null;
  const archiveIndex = Buffer.from(bytes).toString("latin1");
  if (!archiveIndex.includes("[Content_Types].xml")) return null;
  if (extension === "docx" && archiveIndex.includes("word/")) return DOCUMENT_MIME_TYPES.docx;
  if (extension === "xlsx" && archiveIndex.includes("xl/")) return DOCUMENT_MIME_TYPES.xlsx;
  return null;
}

export function validateDocumentFile(name: string, bytes: Uint8Array) {
  const extension = extensionOf(name);
  if (!(extension in DOCUMENT_MIME_TYPES)) throw new UnsupportedDocumentFileError();

  let mimeType: string | null = null;
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) mimeType = DOCUMENT_MIME_TYPES.pdf;
  else if (startsWith(bytes, [0xff, 0xd8, 0xff])) mimeType = DOCUMENT_MIME_TYPES.jpg;
  else if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) mimeType = DOCUMENT_MIME_TYPES.png;
  else mimeType = officeMime(bytes, extension);

  if (!mimeType && (extension === "csv" || extension === "txt") && isSafeText(bytes)) {
    mimeType = DOCUMENT_MIME_TYPES[extension];
  }

  const expectedMime = DOCUMENT_MIME_TYPES[extension as keyof typeof DOCUMENT_MIME_TYPES];
  if (!mimeType || mimeType !== expectedMime) throw new UnsupportedDocumentFileError();
  return { mimeType, extension };
}
