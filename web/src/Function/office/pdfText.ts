// A PDF's text, taken out in the browser (nothing is sent anywhere); pages
// joined by a form feed (\f).
export async function pdfToText(data: ArrayBuffer): Promise<{ text: string; pages: number }> {
  const { extractText, getDocumentProxy } = await import('unpdf');
  const pdf = await getDocumentProxy(new Uint8Array(data));
  const { totalPages, text } = await extractText(pdf, { mergePages: false });
  return { text: (text as string[]).join('\f'), pages: totalPages };
}
