const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'aimall-rag-jwt-secret-2026';

// ── JWT Token Verifier ──
function verifyToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const headerKey  = req.headers['x-admin-key'];
    const ADMIN_KEY  = process.env.ADMIN_KEY || 'efvframework';

    // Legacy key-based auth (backward compat)
    if (headerKey && headerKey === ADMIN_KEY) {
        req.user = { role: 'admin', username: 'admin', legacy: true };
        return next();
    }

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ success: false, error: 'No token provided' });
    }

    const token = authHeader.split(' ')[1];
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (err) {
        return res.status(401).json({ success: false, error: 'Invalid or expired token' });
    }
}

// ── Admin-only gate ──
function requireAdmin(req, res, next) {
    if (!req.user) return res.status(401).json({ success: false, error: 'Unauthenticated' });
    if (req.user.role !== 'admin') {
        return res.status(403).json({ success: false, error: 'Admin access required' });
    }
    next();
}

// ── Viewer or Admin gate ──
function requireViewer(req, res, next) {
    if (!req.user) return res.status(401).json({ success: false, error: 'Unauthenticated' });
    if (!['admin', 'viewer'].includes(req.user.role)) {
        return res.status(403).json({ success: false, error: 'Access denied' });
    }
    next();
}

module.exports = { verifyToken, requireAdmin, requireViewer, JWT_SECRET };
