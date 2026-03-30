/**
 * Document Routes — Upload, process, list, delete, reprocess
 */
const express   = require('express');
const multer    = require('multer');
const path      = require('path');
const { v4: uuidv4 } = require('uuid');
const Document  = require('../models/Document');
const { verifyToken, requireAdmin, requireViewer } = require('../middleware/auth');
const { extractText, chunkText, detectLanguage }   = require('../services/documentProcessor');
const { generateEmbeddingsBatch }                  = require('../services/embeddingService');
const { upsertVectors, deleteVectors }             = require('../services/vectorService');
const { storeFile, deleteLocalFile, UPLOAD_DIR }   = require('../services/storageService');
const { fireWebhook }                              = require('../services/webhookService');

const router = express.Router();

// ── Multer Config ──────────────────────────────────────────────────────────────
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename:    (req, file, cb) => {
        const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
        cb(null, `${uuidv4()}_${safe}`);
    }
});
const upload = multer({
    storage,
    limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
    fileFilter: (req, file, cb) => {
        const allowed = ['application/pdf', 'text/plain',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/msword'];
        if (allowed.includes(file.mimetype) ||
            ['.pdf','.txt','.docx','.doc'].includes(path.extname(file.originalname).toLowerCase())) {
            cb(null, true);
        } else {
            cb(new Error('Only PDF, DOCX, and TXT files are allowed'));
        }
    }
});

// ── JSON Helpers ──
const fs = require('fs');
const KNOWLEDGE_PATH = path.join(__dirname, '../knowledge.json');
const readKnowledge = () => {
    try { return JSON.parse(fs.readFileSync(KNOWLEDGE_PATH, 'utf8')); }
    catch (e) { return { documents: [] }; }
};
const writeKnowledge = (data) => fs.writeFileSync(KNOWLEDGE_PATH, JSON.stringify(data, null, 2));

// ── Background processing function ──────────────────────────────────────────
async function processDocument(id) {
    try {
        const data = readKnowledge();
        const doc = data.documents.find(d => d.id === id);
        if (!doc) return;

        doc.status = 'processing';
        writeKnowledge(data);

        // 1. Extract text
        const text     = await extractText(doc.path, doc.mimeType);
        const language = detectLanguage(text);

        // 2. Chunk
        const chunks = chunkText(text);
        if (chunks.length === 0) throw new Error('No text content extracted');

        // 3. Generate embeddings
        const texts      = chunks.map(c => c.content);
        const embeddings = await generateEmbeddingsBatch(texts);
        chunks.forEach((c, i) => { c.embedding = embeddings[i] || []; });

        // 4. Update knowledge.json
        const freshData = readKnowledge();
        const freshDoc = freshData.documents.find(d => d.id === id);
        if (freshDoc) {
            freshDoc.status        = 'processed';
            freshDoc.chunks        = chunks;
            freshDoc.chunkCount    = chunks.length;
            freshDoc.language      = language;
            freshDoc.processed_at  = new Date();
            writeKnowledge(freshData);
        }

        console.log(`✅ Document processed: ${doc.name} → ${chunks.length} chunks`);
    } catch (err) {
        console.error(`❌ Processing failed for document ${id}:`, err.message);
        const data = readKnowledge();
        const doc = data.documents.find(d => d.id === id);
        if (doc) { doc.status = 'error'; doc.error = err.message; writeKnowledge(data); }
    }
}

// ── POST /api/documents/upload ────────────────────────────────────────────────
router.post('/upload', verifyToken, requireAdmin, upload.single('document'), async (req, res) => {
    if (!req.file) return res.status(400).json({ success: false, error: 'No file uploaded' });

    try {
        const { url, storageType } = await storeFile(req.file.path, req.file.originalname);
        const id = uuidv4();
        const data = readKnowledge();
        
        const doc = {
            id,
            path:         req.file.path,
            name:         req.file.originalname,
            mimeType:     req.file.mimetype,
            size:         req.file.size,
            url,
            storageType,
            status:       'pending',
            uploadedBy:   req.user.username,
            createdAt:    new Date().toISOString()
        };
        data.documents.push(doc);
        writeKnowledge(data);

        // Process asynchronously
        processDocument(id).catch(console.error);

        res.json({ success: true, document: { id, filename: doc.name, status: doc.status } });
    } catch (err) {
        console.error('❌ Upload Error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ── GET /api/documents ────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
    try {
        if (!fs.existsSync(KNOWLEDGE_PATH)) return res.json({ success: true, data: [], documents: [], total: 0 });
        const content = fs.readFileSync(KNOWLEDGE_PATH, 'utf8');
        let data = { documents: [] };
        try { data = JSON.parse(content); } catch(e) {}
        
        const docs = (data.documents || []).map(d => ({
            _id: d.id || d._id,
            filename: d.name || d.originalName,
            status: d.status || 'processed',
            chunks: d.chunks || [],
            createdAt: d.createdAt || new Date(),
            extension: (d.name || d.originalName || '').split('.').pop(),
            publicUrl: d.url || (d.path ? `/uploads/${path.basename(d.path)}` : '#'),
            storagePath: d.path || '#'
        }));
        res.json({ success: true, data: docs });
    } catch (err) {
        console.error('❌ Document List Error:', err.message);
        res.status(500).json({ success: false, error: err.message, data: [] });
    }
});

// ── GET /api/documents/:id ────────────────────────────────────────────────────
router.get('/:id', verifyToken, requireViewer, async (req, res) => {
    try {
        const data = readKnowledge();
        const doc = data.documents.find(d => String(d.id || d._id) === String(req.params.id));
        if (!doc) return res.status(404).json({ success: false, error: 'Document not found' });
        
        // Return without chunks array for lightweight response if needed
        const { chunks, ...docWithoutChunks } = doc;
        res.json({ success: true, document: docWithoutChunks });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ── POST /api/documents/:id/reprocess ────────────────────────────────────────
router.post('/:id/reprocess', verifyToken, requireAdmin, async (req, res) => {
    try {
        const data = readKnowledge();
        const doc = data.documents.find(d => String(d.id || d._id) === String(req.params.id));
        if (!doc) return res.status(404).json({ success: false, error: 'Document not found' });

        res.json({ success: true, message: 'Reprocessing started' });
        processDocument(doc.id || doc._id).catch(console.error);
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ── DELETE /api/documents/:id ─────────────────────────────────────────────────
router.delete('/:id', verifyToken, requireAdmin, async (req, res) => {
    try {
        const data = readKnowledge();
        const doc = data.documents.find(d => String(d.id || d._id) === String(req.params.id));
        if (!doc) return res.status(404).json({ success: false, error: 'Document not found' });

        await deleteVectors(doc.id || doc._id, doc.chunkCount);
        deleteLocalFile(doc.filename || doc.name);
        
        data.documents = data.documents.filter(d => String(d.id || d._id) !== String(req.params.id));
        writeKnowledge(data);

        res.json({ success: true, message: 'Document deleted' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
