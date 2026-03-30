/**
 * Auth Routes — JWT login, register, profile
 */
const express   = require('express');
const bcrypt    = require('bcryptjs');
const jwt       = require('jsonwebtoken');
const AdminUser = require('../models/AdminUser');
const { verifyToken, requireAdmin, JWT_SECRET } = require('../middleware/auth');

const router = express.Router();

// ── POST /api/auth/login ──────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) return res.status(400).json({ success: false, error: 'Username and password required' });

        // Seed default admin if none exists
        const count = await AdminUser.countDocuments();
        if (count === 0) {
            const hashed = await bcrypt.hash('admin123', 10);
            await AdminUser.create({ username: 'admin', email: 'admin@aimall.ai', password: hashed, role: 'admin' });
            console.log('🔐 Default admin created: admin / admin123');
        }

        const user = await AdminUser.findOne({ username, isActive: true });
        if (!user) return res.status(401).json({ success: false, error: 'Invalid credentials' });

        const valid = await bcrypt.compare(password, user.password);
        if (!valid) return res.status(401).json({ success: false, error: 'Invalid credentials' });

        const token = jwt.sign(
            { userId: user._id, username: user.username, role: user.role },
            JWT_SECRET,
            { expiresIn: '24h' }
        );

        await user.updateOne({ lastLogin: new Date() });
        res.json({ success: true, token, user: { username: user.username, role: user.role, email: user.email } });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ── POST /api/auth/register (admin only) ─────────────────────────────────────
router.post('/register', verifyToken, requireAdmin, async (req, res) => {
    try {
        const { username, email, password, role } = req.body;
        if (!username || !email || !password) return res.status(400).json({ success: false, error: 'All fields required' });

        const hashed = await bcrypt.hash(password, 10);
        const user   = await AdminUser.create({ username, email, password: hashed, role: role || 'viewer' });
        res.json({ success: true, user: { id: user._id, username: user.username, role: user.role } });
    } catch (err) {
        if (err.code === 11000) return res.status(409).json({ success: false, error: 'Username or email already exists' });
        res.status(500).json({ success: false, error: err.message });
    }
});

// ── GET /api/auth/me ──────────────────────────────────────────────────────────
router.get('/me', verifyToken, async (req, res) => {
    try {
        const user = await AdminUser.findById(req.user.userId).select('-password');
        if (!user) return res.status(404).json({ success: false, error: 'User not found' });
        res.json({ success: true, user });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ── GET /api/auth/users (admin only) ─────────────────────────────────────────
router.get('/users', verifyToken, requireAdmin, async (req, res) => {
    try {
        const users = await AdminUser.find().select('-password').sort({ created_at: -1 });
        res.json({ success: true, users });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ── PATCH /api/auth/users/:id (admin only) ────────────────────────────────────
router.patch('/users/:id', verifyToken, requireAdmin, async (req, res) => {
    try {
        const { role, isActive } = req.body;
        await AdminUser.findByIdAndUpdate(req.params.id, { role, isActive });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
