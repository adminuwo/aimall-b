require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const mongoose = require('mongoose');
const path     = require('path');

const app  = express();
const PORT = process.env.PORT || 3001;

// ── Middleware ──
app.use(cors());
app.use(express.json());

// ── MongoDB Connection ──
const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
    console.error('❌ MONGO_URI is missing from .env!');
    process.exit(1);
}

mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ MongoDB Connected Successfuly'))
    .catch(err => console.error('❌ MongoDB Connection Error:', err));

// ── Models ──
const ContactSchema = new mongoose.Schema({
    name:       { type: String, required: true },
    company:    String,
    email:      { type: String, required: true },
    interest:   String,
    message:    { type: String, required: true },
    status:     { type: String, default: 'new' },
    created_at: { type: Date, default: Date.now }
});

const PartnerSchema = new mongoose.Schema({
    name:         { type: String, required: true },
    company:      { type: String, required: true },
    email:        { type: String, required: true },
    phone:        String,
    partner_type: String,
    website:      String,
    message:      String,
    status:       { type: String, default: 'pending' },
    created_at:   { type: Date, default: Date.now }
});

const Contact = mongoose.model('Contact', ContactSchema);
const Partner = mongoose.model('Partner', PartnerSchema);

// ── Auth Middleware ──
const ADMIN_KEY = process.env.ADMIN_KEY || 'aimall-admin-2026'; 
function adminAuth(req, res, next) {
    const key = req.headers['x-admin-key'] || req.query.key;
    if (key !== ADMIN_KEY) return res.status(401).json({ error: 'Unauthorized' });
    next();
}

// ════════════════════════════════
// PUBLIC API ROUTES
// ════════════════════════════════

// POST /api/contact
app.post('/api/contact', async (req, res) => {
    try {
        const entry = new Contact(req.body);
        await entry.save();
        res.json({ success: true, id: entry._id, message: 'Message received! We will contact you within 24 hours.' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST /api/partner
app.post('/api/partner', async (req, res) => {
    try {
        const entry = new Partner(req.body);
        await entry.save();
        res.json({ success: true, id: entry._id, message: 'Application submitted! Our partnership team will reach out soon.' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ════════════════════════════════
// ADMIN API ROUTES
// ════════════════════════════════

// GET /api/admin/stats
app.get('/api/admin/stats', adminAuth, async (req, res) => {
    try {
        const [totalContacts, newContacts, totalPartners, pendingPartners] = await Promise.all([
            Contact.countDocuments(),
            Contact.countDocuments({ status: 'new' }),
            Partner.countDocuments(),
            Partner.countDocuments({ status: 'pending' })
        ]);

        const today = new Date();
        today.setHours(0,0,0,0);
        
        const [todayContacts, todayPartners] = await Promise.all([
            Contact.countDocuments({ created_at: { $gte: today } }),
            Partner.countDocuments({ created_at: { $gte: today } })
        ]);

        res.json({
            success: true,
            stats: {
                totalContacts, newContacts, totalPartners, pendingPartners, todayContacts, todayPartners
            }
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/admin/contacts
app.get('/api/admin/contacts', adminAuth, async (req, res) => {
    try {
        const data = await Contact.find().sort({ created_at: -1 });
        // Map _id to id for frontend compatibility
        const mapped = data.map(c => ({ ...c._doc, id: c._id }));
        res.json({ success: true, data: mapped, total: mapped.length });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/admin/partners
app.get('/api/admin/partners', adminAuth, async (req, res) => {
    try {
        const data = await Partner.find().sort({ created_at: -1 });
        const mapped = data.map(p => ({ ...p._doc, id: p._id }));
        res.json({ success: true, data: mapped, total: mapped.length });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PATCH /api/admin/contact/:id/status
app.patch('/api/admin/contact/:id/status', adminAuth, async (req, res) => {
    try {
        const c = await Contact.findByIdAndUpdate(req.params.id, { status: req.body.status });
        res.json({ success: !!c });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PATCH /api/admin/partner/:id/status
app.patch('/api/admin/partner/:id/status', adminAuth, async (req, res) => {
    try {
        const p = await Partner.findByIdAndUpdate(req.params.id, { status: req.body.status });
        res.json({ success: !!p });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/admin/contact/:id
app.delete('/api/admin/contact/:id', adminAuth, async (req, res) => {
    try {
        const c = await Contact.findByIdAndDelete(req.params.id);
        res.json({ success: !!c });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/admin/partner/:id
app.delete('/api/admin/partner/:id', adminAuth, async (req, res) => {
    try {
        const p = await Partner.findByIdAndDelete(req.params.id);
        res.json({ success: !!p });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── Static Path Management (Production) ──
const fs = require('fs');
const distPath = path.join(__dirname, '../frontend/dist');

// Only serve static files if the frontend build exists (useful for single-container deployment)
if (fs.existsSync(distPath)) {
    console.log('📦 Serving compiled frontend from:', distPath);
    app.use(express.static(distPath));
    
    // Catch-all to serve index.html for SPA routing
    app.get('*', (req, res, next) => {
        if (req.path.startsWith('/api')) return next();
        res.sendFile(path.join(distPath, 'index.html'));
    });
}

// ── Start ──
app.listen(PORT, () => {
    console.log('\n🚀 AI-Mall™ Backend running at http://localhost:' + PORT);
    console.log('📦 Connected to MongoDB Atlas');
});
