/**
 * Analytics Routes — Query stats, top queries, logs panel (Using Local Data)
 */
const express   = require('express');
const { verifyToken, requireViewer } = require('../middleware/auth');
const { readData } = require('../utils/dataStore');
const fs = require('fs');
const path = require('path');

const KNOWLEDGE_PATH = path.join(__dirname, '../knowledge.json');

const getDocsData = () => {
    try {
        if (!fs.existsSync(KNOWLEDGE_PATH)) return { documents: [] };
        return JSON.parse(fs.readFileSync(KNOWLEDGE_PATH, 'utf8'));
    } catch (e) { return { documents: [] }; }
};

const router = express.Router();

// ── GET /api/analytics/overview ──────────────────────────────────────────────
router.get('/overview', verifyToken, requireViewer, async (req, res) => {
    try {
        const data = readData();
        const logs = data.queryLogs || [];
        const knowledgeData = getDocsData();
        const docs = knowledgeData.documents || [];

        const totalQueries = logs.length;
        const ragQueries = logs.filter(l => l.ragUsed === true).length;
        const fallbackQueries = logs.filter(l => l.fallbackUsed === true).length;
        const failedQueries = logs.filter(l => l.success === false).length;

        const totalDocs = docs.length;
        const processedDocs = docs.filter(d => d.status === 'processed').length;

        // Today's queries
        const todayStr = new Date().toDateString();
        const todayQueries = logs.filter(l => l.created_at && new Date(l.created_at).toDateString() === todayStr).length;

        // Avg response time
        const successfulLogs = logs.filter(l => l.success === true);
        const avgResponseMs = successfulLogs.length ? successfulLogs.reduce((acc, curr) => acc + (curr.responseTimeMs || 0), 0) / successfulLogs.length : 0;

        res.json({
            success: true,
            stats: {
                totalQueries, ragQueries, fallbackQueries, failedQueries,
                totalDocs, processedDocs, todayQueries,
                avgResponseMs: Math.round(avgResponseMs),
                ragSuccessRate: totalQueries ? ((ragQueries / totalQueries) * 100).toFixed(1) : "0.0"
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ── GET /api/analytics/top-queries ───────────────────────────────────────────
router.get('/top-queries', verifyToken, requireViewer, async (req, res) => {
    try {
        const data = readData();
        const logs = data.queryLogs || [];

        const totals = {};
        for (const log of logs) {
            if (!log.userQuery) continue;
            const q = log.userQuery.toLowerCase();
            if (!totals[q]) totals[q] = { _id: q, count: 0, ragHits: 0, lastAsked: log.created_at || new Date('1970-01-01').toISOString() };
            totals[q].count++;
            if (log.ragUsed) totals[q].ragHits++;
            if (new Date(log.created_at) > new Date(totals[q].lastAsked)) totals[q].lastAsked = log.created_at;
        }

        const topQueries = Object.values(totals).sort((a, b) => b.count - a.count).slice(0, 20);
        res.json({ success: true, topQueries });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ── GET /api/analytics/failed-queries ────────────────────────────────────────
router.get('/failed-queries', verifyToken, requireViewer, async (req, res) => {
    try {
        const data = readData();
        const logs = (data.queryLogs || []).filter(l => l.success === false)
            .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
            .slice(0, 50)
            .map(l => ({ userQuery: l.userQuery, errorMessage: l.errorMessage, created_at: l.created_at, sessionId: l.sessionId }));
        res.json({ success: true, failedQueries: logs });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ── GET /api/analytics/logs ───────────────────────────────────────────────────
router.get('/logs', verifyToken, requireViewer, async (req, res) => {
    try {
        const page  = parseInt(req.query.page  || 1);
        const limit = parseInt(req.query.limit || 20);
        const skip  = (page - 1) * limit;

        const data = readData();
        let logs = data.queryLogs || [];

        if (req.query.ragOnly === 'true') logs = logs.filter(l => l.ragUsed === true);
        if (req.query.failedOnly === 'true') logs = logs.filter(l => l.success === false);
        if (req.query.sessionId) logs = logs.filter(l => l.sessionId === req.query.sessionId);

        logs.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

        const total = logs.length;
        const pagedLogs = logs.slice(skip, skip + limit);

        res.json({ success: true, logs: pagedLogs, total, page, pages: Math.ceil(total / limit) });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ── GET /api/analytics/daily ──────────────────────────────────────────────────
router.get('/daily', verifyToken, requireViewer, async (req, res) => {
    try {
        const days = parseInt(req.query.days || 7);
        const fromDate = new Date(); fromDate.setDate(fromDate.getDate() - days);

        const data = readData();
        const logs = (data.queryLogs || []).filter(l => new Date(l.created_at) >= fromDate);

        const totals = {};
        for (const log of logs) {
            const dateStr = log.created_at ? new Date(log.created_at).toISOString().split('T')[0] : '1970-01-01';
            if (!totals[dateStr]) totals[dateStr] = { _id: dateStr, total: 0, ragCount: 0, fallbackCount: 0, failCount: 0 };
            totals[dateStr].total++;
            if (log.ragUsed) totals[dateStr].ragCount++;
            if (log.fallbackUsed) totals[dateStr].fallbackCount++;
            if (log.success === false) totals[dateStr].failCount++;
        }

        const daily = Object.values(totals).sort((a, b) => a._id.localeCompare(b._id));
        res.json({ success: true, daily });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
