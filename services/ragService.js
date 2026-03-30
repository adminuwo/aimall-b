/**
 * RAG Service — Core Pipeline
 * Query → Embed → Search → (Re-rank) → LLM → Stream response
 */

const { generateEmbedding } = require('./embeddingService');
const { querySimilar, reRankResults, SIMILARITY_THRESHOLD } = require('./vectorService');
const { aiInstance, modelName, getDynamicSystemInstruction } = require('../config/vertex');

const MULTILINGUAL_INSTRUCTION = {
    hi: 'कृपया हिंदी में उत्तर दें।',
    en: 'Respond in English.',
    mixed: 'Respond in the same language as the question.'
};

/**
 * Detect if query is predominantly Hindi
 */
function detectQueryLanguage(text) {
    const hindiChars = (text.match(/[\u0900-\u097F]/g) || []).length;
    return hindiChars > text.length * 0.2 ? 'hi' : 'en';
}

/**
 * Build RAG prompt from context chunks
 */
function buildRAGPrompt(query, chunks, lang) {
    const context = chunks.map((c, i) => `[Source ${i + 1}]: ${c.content}`).join('\n\n');
    const langInstruction = MULTILINGUAL_INSTRUCTION[lang] || MULTILINGUAL_INSTRUCTION.en;

    return `You are AI-Mall bot, the AI-Mall Smart Assistant. ${langInstruction}

Use ONLY the following knowledge base context to answer the user's question. 
If the context doesn't contain enough information, say so clearly.

=== KNOWLEDGE BASE CONTEXT ===
${context}
==============================

User Question: ${query}

Answer based strictly on the context above. Be concise, accurate, and helpful.`;
}

/**
 * Build fallback prompt (no RAG context)
 */
function buildFallbackPrompt(query, lang) {
    const langInstruction = MULTILINGUAL_INSTRUCTION[lang] || MULTILINGUAL_INSTRUCTION.en;
    return `You are AI-Mall bot, the AI-Mall Smart Assistant. ${langInstruction}
Answer this question using your general knowledge about AI, technology, and business solutions (Answer directly as the context from RAG was insufficient): ${query}`;
}

/**
 * Full RAG pipeline — streaming version (SSE compatible)
 */
async function ragQueryStream(query, history = [], onChunk, onDone, onError) {
    const startTime = Date.now();
    const lang = detectQueryLanguage(query);
    console.log(`🤖 Processing RAG Query: "${query}" (Language: ${lang})`);

    try {
        // Step 1: Embed query
        let queryEmbedding;
        try {
            queryEmbedding = await generateEmbedding(query);
            console.log('✅ Query embedding generated');
        } catch (e) {
            console.warn('⚠️ Embedding failed, using fallback LLM:', e.message);
            return await fallbackStream(query, history, lang, onChunk, onDone, onError, startTime, false, 0);
        }

        // Step 2: Search vector DB
        const rawResults = await querySimilar(queryEmbedding);
        console.log(`🔍 Vector search found ${rawResults.length} initial results`);

        // Step 3: Re-rank
        const results = reRankResults(rawResults, query);
        const topScore = results.length > 0 ? results[0].similarityScore : 0;
        const ragUsed = topScore >= SIMILARITY_THRESHOLD;

        console.log(`🔍 RAG: top score=${topScore.toFixed(3)}, threshold=${SIMILARITY_THRESHOLD}, ragUsed=${ragUsed}`);

        // If RAG score isn't met, let's pass to fallback directly
        if (!ragUsed) {
            console.log(`⚠️ Low RAG score (${topScore.toFixed(3)}), redirecting to standard fallback AI`);
            return await fallbackStream(query, history, lang, onChunk, onDone, onError, startTime, false, topScore);
        }

        // --- RAG SUCCEEDED, CONSTRUCT PROMPT ---
        const topChunks = results.slice(0, 4);
        const prompt = buildRAGPrompt(query, topChunks, lang);

        const cleanHistory = (history || []).map(h => ({
            role: h.role === 'model' ? 'model' : 'user',
            parts: [{ text: h.parts[0].text || "" }]
        }));

        // Step 4: Stream LLM response
        // Step 4: Stream LLM response
        console.log(`🧠 Calling Vertex AI model (${modelName}) in RAG mode via @google/genai...`);

        const resultStream = await aiInstance.models.generateContentStream({
            model: modelName,
            contents: [...cleanHistory, { role: 'user', parts: [{ text: prompt }] }],
            config: { systemInstruction: getDynamicSystemInstruction() }
        });

        let fullText = '';
        for await (const chunk of resultStream) {
            const text = chunk.text || '';
            if (text) {
                fullText += text;
                onChunk(text);
            }
        }

        const elapsed = Date.now() - startTime;
        onDone({
            ragUsed: true,
            fallbackUsed: false,
            similarityScore: topScore,
            responseTimeMs: elapsed,
            docSourceIds: results.slice(0, 4).map(r => r.documentId),
            fullText,
            language: lang
        });

    } catch (err) {
        console.error('❌ RAG Pipeline Error:', err.message);
        // Fallback gracefully on catastrophic pipeline errs
        await fallbackStream(query, history, lang, onChunk, onDone, onError, startTime, false, 0);
    }
}

/**
 * Fallback: plain Vertex/Gemini LLM with streaming 
 */
async function fallbackStream(query, history, lang, onChunk, onDone, onError, startTime, ragUsed, topScore) {
    try {
        const prompt = buildFallbackPrompt(query, lang);

        // Ensure history formats are strictly clean for the new SDK
        // new SDK expects `{ role: 'user', parts: [{ text: "foo" }] }`
        const cleanHistory = (history || []).map(h => ({
            role: h.role === 'model' ? 'model' : 'user',
            parts: [{ text: h.parts[0].text || "" }]
        }));

        console.log(`🧠 Calling Vertex AI model (${modelName}) via fallback @google/genai API...`);

        const resultStream = await aiInstance.models.generateContentStream({
            model: modelName,
            contents: [...cleanHistory, { role: 'user', parts: [{ text: prompt }] }],
            config: { systemInstruction: getDynamicSystemInstruction() }
        });

        let fullText = '';
        for await (const chunk of resultStream) {
            const text = chunk.text || '';
            if (text) { fullText += text; onChunk(text); }
        }

        onDone({
            ragUsed: ragUsed || false,
            fallbackUsed: !ragUsed,
            similarityScore: topScore || 0,
            responseTimeMs: Date.now() - startTime,
            docSourceIds: [],
            fullText,
            language: lang
        });
    } catch (err) {
        console.error('❌ Fallback Stream Error:', err.message);
        onError(err);
    }
}

module.exports = { ragQueryStream };
