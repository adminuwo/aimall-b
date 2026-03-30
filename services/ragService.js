/**
 * RAG Service — Core Pipeline
 * Query → Embed → Search → (Re-rank) → LLM → Stream response
 */

const { generateEmbedding }                    = require('./embeddingService');
const { querySimilar, reRankResults, SIMILARITY_THRESHOLD } = require('./vectorService');
const { generativeModel, modelName }           = require('../config/vertex');

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
    const context = chunks.map((c, i) => `[Source ${i+1}]: ${c.content}`).join('\n\n');
    const langInstruction = MULTILINGUAL_INSTRUCTION[lang] || MULTILINGUAL_INSTRUCTION.en;

    return `You are aisa-sout1, the AI-Mall Smart Assistant. ${langInstruction}

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
    return `You are aisa-sout1, the AI-Mall Smart Assistant. ${langInstruction}
Answer this question using your general knowledge about AI, technology, and business solutions (Answer directly as the context from RAG was insufficient): ${query}`;
}

/**
 * Full RAG pipeline — streaming version (SSE compatible)
 */
async function ragQueryStream(query, history = [], onChunk, onDone, onError) {
    const startTime = Date.now();
    const lang = detectQueryLanguage(query);

    try {
        // Step 1: Embed query
        let queryEmbedding;
        try {
            queryEmbedding = await generateEmbedding(query);
        } catch (e) {
            console.warn('⚠️ Embedding failed, using fallback LLM:', e.message);
            return await fallbackStream(query, history, lang, onChunk, onDone, onError, startTime, false, 0);
        }

        // Step 2: Search vector DB
        const rawResults = await querySimilar(queryEmbedding);

        // Step 3: Re-rank
        const results = reRankResults(rawResults, query);
        const topScore = results.length > 0 ? results[0].similarityScore : 0;
        const ragUsed  = topScore >= SIMILARITY_THRESHOLD;

        console.log(`🔍 RAG: top score=${topScore.toFixed(3)}, threshold=${SIMILARITY_THRESHOLD}, ragUsed=${ragUsed}`);

        let prompt;
        if (ragUsed) {
            const topChunks = results.slice(0, 4);
            prompt = buildRAGPrompt(query, topChunks, lang);
        } else {
            prompt = buildFallbackPrompt(query, lang);
        }

        // Step 4: Stream LLM response
        const chat = generativeModel.startChat({
            history: history || [],
            generationConfig: { maxOutputTokens: 2048, temperature: ragUsed ? 0.3 : 0.7 }
        });

        const streamResult = await chat.sendMessageStream(prompt);
        let fullText = '';

        for await (const chunk of streamResult.stream) {
            const text = chunk.text ? chunk.text() : '';
            if (text) {
                fullText += text;
                onChunk(text);
            }
        }

        const elapsed = Date.now() - startTime;
        onDone({
            ragUsed,
            fallbackUsed: !ragUsed,
            similarityScore: topScore,
            responseTimeMs:  elapsed,
            docSourceIds:    ragUsed ? results.slice(0, 4).map(r => r.documentId) : [],
            fullText,
            language: lang
        });

    } catch (err) {
        onError(err);
    }
}

/**
 * Fallback: plain Vertex/Gemini LLM with streaming
 */
async function fallbackStream(query, history, lang, onChunk, onDone, onError, startTime, ragUsed, topScore) {
    try {
        const prompt = buildFallbackPrompt(query, lang);
        const chat   = generativeModel.startChat({ history: history || [] });
        const result = await chat.sendMessageStream(prompt);
        let fullText = '';

        for await (const chunk of result.stream) {
            const text = chunk.text ? chunk.text() : '';
            if (text) { fullText += text; onChunk(text); }
        }

        onDone({
            ragUsed:         false,
            fallbackUsed:    true,
            similarityScore: topScore,
            responseTimeMs:  Date.now() - startTime,
            docSourceIds:    [],
            fullText,
            language: lang
        });
    } catch (err) {
        onError(err);
    }
}

module.exports = { ragQueryStream };
