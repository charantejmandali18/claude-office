export function extractShortResponse(text: string): string {
  const sentences = text.match(/[^.!?]+[.!?]+/g);
  if (sentences && sentences.length >= 1) {
    const short = sentences.slice(0, 2).join(' ').trim();
    return short.length <= 200 ? short : short.slice(0, 197) + '...';
  }
  return text.slice(0, 200);
}
