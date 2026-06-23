import { QdrantClient } from '@qdrant/js-client-rest';

const qdrant = new QdrantClient({
  host: process.env.QDRANT_HOST || 'localhost',
  port: parseInt(process.env.QDRANT_PORT || '6333'),
});

const COLLECTION_NAME = 'knowledge_vectors';
const VECTOR_SIZE = 1536; // OpenAI embedding dimension

export async function initQdrant() {
  try {
    const collections = await qdrant.getCollections();
    const exists = collections.collections.some(c => c.name === COLLECTION_NAME);
    
    if (!exists) {
      await qdrant.createCollection(COLLECTION_NAME, {
        vectors: {
          size: VECTOR_SIZE,
          distance: 'Cosine',
        },
      });
      console.log('✅ Qdrant collection created:', COLLECTION_NAME);
    } else {
      console.log('ℹ️ Qdrant collection already exists:', COLLECTION_NAME);
    }
  } catch (error) {
    console.error('❌ Failed to initialize Qdrant:', error);
    throw error;
  }
}

export async function upsertVectors(points) {
  return await qdrant.upsert(COLLECTION_NAME, {
    wait: true,
    points,
  });
}

export async function searchSimilarVectors(queryVector, limit = 5, minScore = 0.7) {
  const results = await qdrant.search(COLLECTION_NAME, {
    vector: queryVector,
    limit,
    score_threshold: minScore,
  });
  
  return results;
}

export async function deletePointsByFilter(filter) {
  return await qdrant.delete(COLLECTION_NAME, {
    wait: true,
    filter,
  });
}

export async function deletePoint(pointId) {
  return await qdrant.delete(COLLECTION_NAME, {
    wait: true,
    points: [pointId],
  });
}

export { qdrant };
