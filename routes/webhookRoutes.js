/**
 * Webhook Management Routes (Using Local Data)
 */
const express         = require('express');
const { verifyToken, requireAdmin } = require('../middleware/auth');
const { readData, writeData, uuidv4 } = require('../utils/dataStore');

const router = express.Router();

router.get('/',    verifyToken, requireAdmin, async (req, res) => {
    const data = readData();
    const hooks = data.webhooks || [];
    res.json({ success: true, webhooks: hooks });
});

router.post('/',   verifyToken, requireAdmin, async (req, res) => {
    try {
        const data = readData();
        if (!data.webhooks) data.webhooks = [];
        const hook = { id: uuidv4(), ...req.body, created_at: new Date() };
        data.webhooks.push(hook);
        writeData(data);
        res.json({ success: true, webhook: hook });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.patch('/:id', verifyToken, requireAdmin, async (req, res) => {
    try {
        const data = readData();
        let found = false;
        data.webhooks = (data.webhooks || []).map(hook => {
            if (String(hook.id || hook._id) === String(req.params.id)) {
                found = true;
                return { ...hook, ...req.body };
            }
            return hook;
        });
        if (found) writeData(data);
        res.json({ success: found });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.delete('/:id', verifyToken, requireAdmin, async (req, res) => {
    try {
        const data = readData();
        const initialLen = (data.webhooks || []).length;
        data.webhooks = (data.webhooks || []).filter(hook => String(hook.id || hook._id) !== String(req.params.id));
        if (data.webhooks.length !== initialLen) writeData(data);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

module.exports = router;
