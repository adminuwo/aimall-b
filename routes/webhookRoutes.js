/**
 * Webhook Management Routes
 */
const express         = require('express');
const WebhookConfig   = require('../models/WebhookConfig');
const { verifyToken, requireAdmin } = require('../middleware/auth');

const router = express.Router();

router.get('/',    verifyToken, requireAdmin, async (req, res) => {
    const hooks = await WebhookConfig.find().sort({ created_at: -1 });
    res.json({ success: true, webhooks: hooks });
});

router.post('/',   verifyToken, requireAdmin, async (req, res) => {
    try {
        const hook = await WebhookConfig.create(req.body);
        res.json({ success: true, webhook: hook });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.patch('/:id', verifyToken, requireAdmin, async (req, res) => {
    try {
        await WebhookConfig.findByIdAndUpdate(req.params.id, req.body);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.delete('/:id', verifyToken, requireAdmin, async (req, res) => {
    try {
        await WebhookConfig.findByIdAndDelete(req.params.id);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

module.exports = router;
