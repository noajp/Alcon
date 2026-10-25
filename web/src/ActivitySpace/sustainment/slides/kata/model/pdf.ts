// PDF から文字を抜く（ブラウザの中で。外へは送らない）。ページは \f で区切って返す
export async function pdfToText(data: ArrayBuffer): Promise<{ text: string; pages: number }> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(data));
  const { totalPages, text } = await extractText(pdf, { mergePages: false });
  return { text: (text as string[]).join("\f"), pages: totalPages };
}
