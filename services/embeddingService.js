/**
 * Embedding Service
 * Uses Gemini text-embedding-004 model via Google Generative AI SDK
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');

const EMBEDDING_MODEL = 'text-embedding-005';
const SIMILARITY_THRESHOLD = parseFloat(process.env.RAG_THRESHOLD || '0.70');

let embeddingClient = null;
let vertexEmbedAI = null;

function getEmbeddingClient() {
    if (embeddingClient) return embeddingClient;
    
    const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
    const projectId = process.env.GCP_PROJECT_ID;
    const location = process.env.GCP_LOCATION || 'asia-south1';

    if (apiKey) {
        embeddingClient = new GoogleGenerativeAI(apiKey);
        return embeddingClient;
    } else if (projectId) {
        const { VertexAI } = require('@google-cloud/vertexai');
        vertexEmbedAI = new VertexAI({ project: projectId, location: location });
        return null; // Will trigger Vertex path in generateEmbedding
    }
    
    throw new Error('Neither GOOGLE_API_KEY nor GCP_PROJECT_ID configured for embeddings');
}

/**
 * Generate embedding vector for a single text string
 */
async function generateEmbedding(text) {
    const client = getEmbeddingClient();
    
    if (client) {
        // Gemini API path
        const model = client.getGenerativeModel({ model: EMBEDDING_MODEL });
        const result = await model.embedContent(text.slice(0, 8000));
        return result.embedding.values;
    } else if (vertexEmbedAI) {
        // Vertex AI path (using stable getGenerativeModel in 2026)
        const model = vertexEmbedAI.getGenerativeModel({ model: EMBEDDING_MODEL });
        const result = await model.embedContent({
            content: { role: 'user', parts: [{ text: text.slice(0, 8000) }] }
        });
        return result.embedding.values;
    }
    throw new Error('AI Embedding initialization failed');
}

/**
 * Generate embeddings for multiple texts (batched)
 * @returns {number[][]}
 */
async function generateEmbeddingsBatch(texts) {
    // Process in batches of 5 to respect rate limits
    const BATCH = 5;
    const results = [];
    for (let i = 0; i < texts.length; i += BATCH) {
        const batch = texts.slice(i, i + BATCH);
        const batchResults = await Promise.all(batch.map(t => generateEmbedding(t)));
        results.push(...batchResults);
        if (i + BATCH < texts.length) {
            await new Promise(r => setTimeout(r, 500)); // rate limit pause
        }
    }
    return results;
}

/**
 * Cosine similarity between two vectors
 */
function cosineSimilarity(a, b) {
    if (!a || !b || a.length !== b.length) return 0;
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
        dot   += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    if (normA === 0 || normB === 0) return 0;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

module.exports = {
    generateEmbedding,
    generateEmbeddingsBatch,
    cosineSimilarity,
    SIMILARITY_THRESHOLD
};
