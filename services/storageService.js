/**
 * Storage Service
 * Saves uploaded files to local disk (default) or Google Cloud Storage (if configured)
 */

const fs   = require('fs');
const path = require('path');

const UPLOAD_DIR = path.join(__dirname, '../uploads');

// Ensure upload dir exists
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ── GCS client (optional) ──────────────────────────────────────────────────
let storageClient = null;
function getGCSClient() {
    if (storageClient) return storageClient;
    const { Storage } = require('@google-cloud/storage');
    const keyFile = path.join(__dirname, '../google_cloud_credentials.json');
    const opts = fs.existsSync(keyFile) ? { keyFilename: keyFile } : {};
    storageClient = new Storage({ projectId: process.env.GCP_PROJECT_ID, ...opts });
    return storageClient;
}

/**
 * Upload file to GCS or return local path
 * Returns { url, storageType }
 */
async function storeFile(localPath, filename) {
    const BUCKET = process.env.GCS_BUCKET_NAME;

    if (BUCKET) {
        try {
            const storage = getGCSClient();
            const bucket  = storage.bucket(BUCKET);
            const destPath = `documents/${Date.now()}_${filename}`;
            await bucket.upload(localPath, {
                destination: destPath,
                metadata: { cacheControl: 'private' }
            });
            const [url] = await bucket.file(destPath).getSignedUrl({
                action:  'read',
                expires: Date.now() + 7 * 24 * 60 * 60 * 1000  // 7 days
            });
            console.log(`☁️  GCS upload: ${destPath}`);
            return { url, storageType: 'gcs' };
        } catch (e) {
            console.warn(`⚠️  GCS upload failed (${e.message}), using local storage`);
        }
    }

    // Local storage fallback
    const url = `/uploads/${path.basename(localPath)}`;
    return { url, storageType: 'local' };
}

/**
 * Delete file from local disk (GCS deletion handled separately)
 */
function deleteLocalFile(filePath) {
    try {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch (e) { /* ignore */ }
}

module.exports = { storeFile, deleteLocalFile, UPLOAD_DIR };
