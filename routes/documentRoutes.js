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

// ── Background processing function ──────────────────────────────────────────
async function processDocument(doc) {
    try {
        await doc.updateOne({ status: 'processing' });

        // 1. Extract text
        const text     = await extractText(doc.filename, doc.mimeType);
        const language = detectLanguage(text);

        // 2. Chunk
        const chunks = chunkText(text);
        if (chunks.length === 0) throw new Error('No text content extracted');

        // 3. Generate embeddings
        const texts      = chunks.map(c => c.content);
        const embeddings = await generateEmbeddingsBatch(texts);
        chunks.forEach((c, i) => { c.embedding = embeddings[i] || []; });

        // 4. Store in vector DB
        await upsertVectors(doc._id, chunks);

        // 5. Update document
        await doc.updateOne({
            status:        'processed',
            extractedText: text.slice(0, 5000), // store first 5k chars preview
            chunks:        chunks,
            chunkCount:    chunks.length,
            language,
            pineconeIndexed: true,
            processed_at:  new Date()
        });

        console.log(`✅ Document processed: ${doc.originalName} → ${chunks.length} chunks`);
        await fireWebhook('upload', { documentId: doc._id, filename: doc.originalName, status: 'processed' });
    } catch (err) {
        await doc.updateOne({ status: 'error', errorMessage: err.message });
        console.error(`❌ Processing failed for ${doc.originalName}:`, err.message);
        await fireWebhook('error', { documentId: doc._id, filename: doc.originalName, error: err.message });
    }
}

// ── POST /api/documents/upload ────────────────────────────────────────────────
router.post('/upload', verifyToken, requireAdmin, upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ success: false, error: 'No file uploaded' });

    try {
        const { url, storageType } = await storeFile(req.file.path, req.file.originalname);

        const doc = await Document.create({
            filename:     req.file.path,
            originalName: req.file.originalname,
            mimeType:     req.file.mimetype,
            fileSize:     req.file.size,
            storageUrl:   url,
            storageType,
            status:       'pending',
            uploadedBy:   req.user.username,
            tags:         req.body.tags ? req.body.tags.split(',').map(t => t.trim()) : []
        });

        // Process asynchronously
        processDocument(doc).catch(console.error);

        res.json({ success: true, document: { id: doc._id, filename: doc.originalName, status: doc.status } });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ── GET /api/documents ────────────────────────────────────────────────────────
router.get('/', verifyToken, requireViewer, async (req, res) => {
    try {
        const docs = await Document.find()
            .select('-chunks -extractedText')
            .sort({ created_at: -1 });
        res.json({ success: true, documents: docs, total: docs.length });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ── GET /api/documents/:id ────────────────────────────────────────────────────
router.get('/:id', verifyToken, requireViewer, async (req, res) => {
    try {
        const doc = await Document.findById(req.params.id).select('-chunks');
        if (!doc) return res.status(404).json({ success: false, error: 'Document not found' });
        res.json({ success: true, document: doc });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ── POST /api/documents/:id/reprocess ────────────────────────────────────────
router.post('/:id/reprocess', verifyToken, requireAdmin, async (req, res) => {
    try {
        const doc = await Document.findById(req.params.id);
        if (!doc) return res.status(404).json({ success: false, error: 'Document not found' });

        res.json({ success: true, message: 'Reprocessing started' });
        processDocument(doc).catch(console.error);
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ── DELETE /api/documents/:id ─────────────────────────────────────────────────
router.delete('/:id', verifyToken, requireAdmin, async (req, res) => {
    try {
        const doc = await Document.findById(req.params.id);
        if (!doc) return res.status(404).json({ success: false, error: 'Document not found' });

        await deleteVectors(doc._id, doc.chunkCount);
        deleteLocalFile(doc.filename);
        await doc.deleteOne();

        res.json({ success: true, message: 'Document deleted' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
