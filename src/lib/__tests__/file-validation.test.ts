import { describe, expect, it } from "vitest";
import { UnsupportedDocumentFileError, validateDocumentFile } from "../file-validation";

describe("document file validation", () => {
  it("detects PDF content without trusting the browser MIME", () => {
    const file = validateDocumentFile("acta.pdf", Buffer.from("%PDF-1.7\ncontenido"));
    expect(file.mimeType).toBe("application/pdf");
  });

  it("rejects a renamed executable", () => {
    expect(() => validateDocumentFile("factura.pdf", Buffer.from("MZ executable"))).toThrow(UnsupportedDocumentFileError);
  });

  it("rejects binary data renamed as text", () => {
    expect(() => validateDocumentFile("notas.txt", Buffer.from([0, 1, 2, 3]))).toThrow(UnsupportedDocumentFileError);
  });

  it("accepts UTF-8 CSV data", () => {
    const file = validateDocumentFile("cuotas.csv", Buffer.from("vivienda,importe\n1A,42.00\n", "utf8"));
    expect(file.mimeType).toBe("text/csv");
  });

  it("requires Office ZIP markers and the matching extension", () => {
    const docx = Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      Buffer.from("... [Content_Types].xml ... word/document.xml ...", "latin1")
    ]);
    expect(validateDocumentFile("acta.docx", docx).mimeType).toContain("wordprocessingml");
    expect(() => validateDocumentFile("acta.xlsx", docx)).toThrow(UnsupportedDocumentFileError);
  });
});
