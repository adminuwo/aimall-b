/**
 * RAG Chat Routes — Streaming SSE endpoint + non-streaming fallback
 */
const express    = require('express');
const QueryLog   = require('../models/QueryLog');
const { ragQueryStream } = require('../services/ragService');
const { fireWebhook }    = require('../services/webhookService');

const router = express.Router();

// ── POST /api/rag/chat/stream  (SSE streaming) ───────────────────────────────
router.post('/chat/stream', async (req, res) => {
    const { message, history = [], sessionId = 'anon' } = req.body;
    if (!message) return res.status(400).json({ success: false, error: 'Message required' });

    // SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.flushHeaders();

    const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

    // Ping to prevent 30s timeout
    const ping = setInterval(() => res.write(': ping\n\n'), 15000);

    await ragQueryStream(
        message,
        history,
        // onChunk
        (text) => send({ type: 'chunk', text }),
        // onDone
        async (meta) => {
            clearInterval(ping);
            send({ type: 'done', ...meta });
            res.end();

            // Log query
            try {
                await QueryLog.create({
                    sessionId,
                    userQuery:       message,
                    language:        meta.language,
                    ragUsed:         meta.ragUsed,
                    fallbackUsed:    meta.fallbackUsed,
                    similarityScore: meta.similarityScore,
                    docSourceIds:    meta.docSourceIds,
                    responseText:    meta.fullText.slice(0, 1000),
                    responseTimeMs:  meta.responseTimeMs,
                    success:         true,
                    userIp:          req.ip
                });
            } catch (e) { /* non-blocking */ }

            await fireWebhook('query', { sessionId, query: message, ragUsed: meta.ragUsed });
        },
        // onError
        async (err) => {
            clearInterval(ping);
            console.error('❌ RAG stream error:', err.message);
            send({ type: 'error', message: 'Something went wrong. Please try again.' });
            res.end();
            try {
                await QueryLog.create({
                    sessionId, userQuery: message, success: false,
                    errorMessage: err.message, userIp: req.ip
                });
            } catch (e) { /* non-blocking */ }
        }
    );
});

// ── POST /api/rag/chat  (non-streaming, backward compat) ─────────────────────
router.post('/chat', async (req, res) => {
    const { message, history = [], sessionId = 'anon' } = req.body;
    if (!message) return res.status(400).json({ success: false, error: 'Message required' });

    let fullResponse = '', meta = {};

    try {
        await new Promise((resolve, reject) => {
            ragQueryStream(
                message, history,
                (chunk) => { fullResponse += chunk; },
                (m)     => { meta = m; resolve(); },
                (err)   => reject(err)
            );
        });

        try {
            await QueryLog.create({
                sessionId,
                userQuery:       message,
                language:        meta.language,
                ragUsed:         meta.ragUsed,
                fallbackUsed:    meta.fallbackUsed,
                similarityScore: meta.similarityScore,
                docSourceIds:    meta.docSourceIds,
                responseText:    fullResponse.slice(0, 1000),
                responseTimeMs:  meta.responseTimeMs,
                success:         true,
                userIp:          req.ip
            });
        } catch (e) { /* non-blocking */ }

        res.json({ success: true, answer: fullResponse, ...meta });
    } catch (err) {
        res.status(500).json({ success: false, error: 'AI processing failed', details: err.message });
    }
});

module.exports = router;
