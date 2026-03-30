/**
 * Auth Routes — JWT login, register, profile
 */
const express   = require('express');
const bcrypt    = require('bcryptjs');
const jwt       = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { verifyToken, requireAdmin, JWT_SECRET } = require('../middleware/auth');

const DATA_PATH = path.join(__dirname, '../data.json');
const readData = () => {
    try { return JSON.parse(fs.readFileSync(DATA_PATH, 'utf8')); }
    catch (e) { return { users: [] }; }
};
const writeData = (data) => fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));

const router = express.Router();

// ── POST /api/auth/login ──────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) return res.status(400).json({ success: false, error: 'Username and password required' });

        const data = readData();
        if (!data.users) data.users = [];

        // Seed default admin if none exists
        if (data.users.length === 0) {
            const hashed = await bcrypt.hash('admin123', 10);
            data.users.push({ id: uuidv4(), username: 'admin', email: 'admin@aimall.ai', password: hashed, role: 'admin', isActive: true });
            writeData(data);
            console.log('🔐 Default admin created: admin / admin123');
        }

        const user = data.users.find(u => u.username === username && u.isActive !== false);
        if (!user) return res.status(401).json({ success: false, error: 'Invalid credentials' });

        const valid = await bcrypt.compare(password, user.password);
        if (!valid) return res.status(401).json({ success: false, error: 'Invalid credentials' });

        const token = jwt.sign(
            { userId: user.id || user._id, username: user.username, role: user.role },
            JWT_SECRET,
            { expiresIn: '24h' }
        );

        user.lastLogin = new Date().toISOString();
        writeData(data);

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

        const data = readData();
        if (!data.users) data.users = [];

        if (data.users.find(u => u.username === username || u.email === email)) {
            return res.status(409).json({ success: false, error: 'Username or email already exists' });
        }

        const hashed = await bcrypt.hash(password, 10);
        const user = { id: uuidv4(), username, email, password: hashed, role: role || 'viewer', isActive: true };
        data.users.push(user);
        writeData(data);

        res.json({ success: true, user: { id: user.id, username: user.username, role: user.role } });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ── GET /api/auth/me ──────────────────────────────────────────────────────────
router.get('/me', verifyToken, async (req, res) => {
    try {
        const data = readData();
        const user = (data.users || []).find(u => String(u.id || u._id) === String(req.user.userId));
        if (!user) return res.status(404).json({ success: false, error: 'User not found' });
        const { password, ...userWithoutPassword } = user;
        res.json({ success: true, user: userWithoutPassword });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ── GET /api/auth/users (admin only) ─────────────────────────────────────────
router.get('/users', verifyToken, requireAdmin, async (req, res) => {
    try {
        const data = readData();
        const users = (data.users || []).map(({ password, ...rest }) => rest);
        res.json({ success: true, users });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ── PATCH /api/auth/users/:id (admin only) ────────────────────────────────────
router.patch('/users/:id', verifyToken, requireAdmin, async (req, res) => {
    try {
        const { role, isActive } = req.body;
        const data = readData();
        const user = (data.users || []).find(u => String(u.id || u._id) === String(req.params.id));
        if (user) {
            user.role = role !== undefined ? role : user.role;
            user.isActive = isActive !== undefined ? isActive : user.isActive;
            writeData(data);
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
