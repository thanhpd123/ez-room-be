/**
 * Gemini Embedding Utility
 * Sử dụng Gemini text-embedding-004 để tạo vector embeddings
 */
const { GoogleGenerativeAI } = require('@google/generative-ai');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const EMBEDDING_MODEL = 'gemini-embedding-001';

let genAI = null;

function getClient() {
    if (!genAI) {
        if (!GEMINI_API_KEY) {
            throw new Error('GEMINI_API_KEY is not configured');
        }
        genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    }
    return genAI;
}

/**
 * Tạo embedding cho một đoạn text
 * @param {string} text
 * @returns {Promise<number[]>} 768-dim vector
 */
async function getEmbedding(text) {
    const model = getClient().getGenerativeModel({ model: EMBEDDING_MODEL });
    const result = await model.embedContent(text);
    return result.embedding.values;
}

/**
 * Tạo embeddings cho nhiều đoạn text (batch)
 * @param {string[]} texts
 * @returns {Promise<number[][]>}
 */
async function getEmbeddings(texts) {
    const model = getClient().getGenerativeModel({ model: EMBEDDING_MODEL });
    const result = await model.batchEmbedContents({
        requests: texts.map((text) => ({ content: { parts: [{ text }] } })),
    });
    return result.embeddings.map((e) => e.values);
}

/**
 * Cosine similarity giữa 2 vectors
 */
function cosineSimilarity(a, b) {
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom === 0 ? 0 : dot / denom;
}

module.exports = { getEmbedding, getEmbeddings, cosineSimilarity };
