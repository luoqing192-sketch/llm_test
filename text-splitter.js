/**
 * Split text into chunks of specified size with overlap
 */
export function splitTextIntoChunks(text, chunkSize = 1000, overlap = 200) {
  const chunks = [];
  let start = 0;
  
  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    chunks.push(text.slice(start, end));
    start = end - overlap;
    
    if (end === text.length) {
      break;
    }
  }
  
  return chunks;
}

/**
 * Extract text content from different file types
 */
export async function extractTextFromBuffer(buffer, fileType) {
  // For now, just treat everything as text
  // In production, you'd use libraries like pdf-parse, mammoth, etc.
  return buffer.toString('utf-8');
}
