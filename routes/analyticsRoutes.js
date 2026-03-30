/**
 * Analytics Routes — Query stats, top queries, logs panel
 */
const express   = require('express');
const QueryLog  = require('../models/QueryLog');
const Document  = require('../models/Document');
const { verifyToken, requireViewer } = require('../middleware/auth');

const router = express.Router();

// ── GET /api/analytics/overview ──────────────────────────────────────────────
router.get('/overview', verifyToken, requireViewer, async (req, res) => {
    try {
        const [
            totalQueries, ragQueries, fallbackQueries, failedQueries,
            totalDocs, processedDocs
        ] = await Promise.all([
            QueryLog.countDocuments(),
            QueryLog.countDocuments({ ragUsed: true }),
            QueryLog.countDocuments({ fallbackUsed: true }),
            QueryLog.countDocuments({ success: false }),
            Document.countDocuments(),
            Document.countDocuments({ status: 'processed' })
        ]);

        // Today's queries
        const today = new Date(); today.setHours(0,0,0,0);
        const todayQueries = await QueryLog.countDocuments({ created_at: { $gte: today } });

        // Avg response time
        const avgAgg = await QueryLog.aggregate([
            { $match: { success: true } },
            { $group: { _id: null, avg: { $avg: '$responseTimeMs' } } }
        ]);
        const avgResponseMs = avgAgg[0]?.avg || 0;

        res.json({
            success: true,
            stats: {
                totalQueries, ragQueries, fallbackQueries, failedQueries,
                totalDocs, processedDocs, todayQueries,
                avgResponseMs: Math.round(avgResponseMs),
                ragSuccessRate: totalQueries ? ((ragQueries / totalQueries) * 100).toFixed(1) : 0
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ── GET /api/analytics/top-queries ───────────────────────────────────────────
router.get('/top-queries', verifyToken, requireViewer, async (req, res) => {
    try {
        const results = await QueryLog.aggregate([
            { $group: {
                _id:   { $toLower: '$userQuery' },
                count: { $sum: 1 },
                ragHits: { $sum: { $cond: ['$ragUsed', 1, 0] } },
                lastAsked: { $max: '$created_at' }
            }},
            { $sort:  { count: -1 } },
            { $limit: 20 }
        ]);
        res.json({ success: true, topQueries: results });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ── GET /api/analytics/failed-queries ────────────────────────────────────────
router.get('/failed-queries', verifyToken, requireViewer, async (req, res) => {
    try {
        const results = await QueryLog.find({ success: false })
            .sort({ created_at: -1 }).limit(50)
            .select('userQuery errorMessage created_at sessionId');
        res.json({ success: true, failedQueries: results });
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

        const filter = {};
        if (req.query.ragOnly     === 'true') filter.ragUsed     = true;
        if (req.query.failedOnly  === 'true') filter.success      = false;
        if (req.query.sessionId)              filter.sessionId    = req.query.sessionId;

        const [logs, total] = await Promise.all([
            QueryLog.find(filter).sort({ created_at: -1 }).skip(skip).limit(limit),
            QueryLog.countDocuments(filter)
        ]);

        res.json({ success: true, logs, total, page, pages: Math.ceil(total / limit) });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ── GET /api/analytics/daily ──────────────────────────────────────────────────
router.get('/daily', verifyToken, requireViewer, async (req, res) => {
    try {
        const days = parseInt(req.query.days || 7);
        const from = new Date(); from.setDate(from.getDate() - days);

        const results = await QueryLog.aggregate([
            { $match: { created_at: { $gte: from } } },
            { $group: {
                _id:          { $dateToString: { format: '%Y-%m-%d', date: '$created_at' } },
                total:        { $sum: 1 },
                ragCount:     { $sum: { $cond: ['$ragUsed', 1, 0] } },
                fallbackCount:{ $sum: { $cond: ['$fallbackUsed', 1, 0] } },
                failCount:    { $sum: { $cond: [{ $eq: ['$success', false] }, 1, 0] } }
            }},
            { $sort: { _id: 1 } }
        ]);
        res.json({ success: true, daily: results });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
