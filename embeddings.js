import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

const openai = new OpenAI({
  apiKey: process.env.LLM_API_KEY,
  baseURL: process.env.LLM_BASE_URL || 'https://api.openai.com/v1',
});

export async function getEmbedding(text) {
  try {
    const response = await openai.embeddings.create({
      model: process.env.EMBEDDING_MODEL || 'text-embedding-ada-002',
      input: text,
    });
    return response.data[0].embedding;
  } catch (error) {
    console.error('Failed to get embedding:', error);
    throw error;
  }
}

export async function getEmbeddings(texts) {
  try {
    const response = await openai.embeddings.create({
      model: process.env.EMBEDDING_MODEL || 'text-embedding-ada-002',
      input: texts,
    });
    return response.data.map(item => item.embedding);
  } catch (error) {
    console.error('Failed to get embeddings:', error);
    throw error;
  }
}
