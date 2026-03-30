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

        // Seed default admin if none exists in DB
        const count = await AdminUser.countDocuments();
        if (count === 0) {
            const hashed = await bcrypt.hash('admin123', 10);
            await AdminUser.create({ username: 'admin', email: 'admin@aimall.ai', password: hashed, role: 'admin', isActive: true });
            console.log('🔐 Default admin created in MongoDB: admin / admin123');
        }

        const user = await AdminUser.findOne({ username, isActive: true });
        if (!user) return res.status(401).json({ success: false, error: 'Invalid credentials or account disabled' });

        const valid = await bcrypt.compare(password, user.password);
        if (!valid) return res.status(401).json({ success: false, error: 'Invalid credentials' });

        const token = jwt.sign(
            { userId: user._id, username: user.username, role: user.role },
            JWT_SECRET,
            { expiresIn: '24h' }
        );

        user.lastLogin = new Date();
        await user.save();

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

        const existing = await AdminUser.findOne({ $or: [{ username }, { email }] });
        if (existing) {
            return res.status(409).json({ success: false, error: 'Username or email already exists' });
        }

        const hashed = await bcrypt.hash(password, 10);
        const user = await AdminUser.create({ username, email, password: hashed, role: role || 'viewer', isActive: true });

        res.json({ success: true, user: { id: user._id, username: user.username, role: user.role } });
    } catch (err) {
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
        const users = await AdminUser.find().select('-password');
        res.json({ success: true, users });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ── PATCH /api/auth/users/:id (admin only) ────────────────────────────────────
router.patch('/users/:id', verifyToken, requireAdmin, async (req, res) => {
    try {
        const { role, isActive } = req.body;
        await AdminUser.findByIdAndUpdate(req.params.id, { 
            ...(role !== undefined && { role }), 
            ...(isActive !== undefined && { isActive }) 
        });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
