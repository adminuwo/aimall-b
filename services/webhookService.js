/**
 * Webhook Service
 * Fire-and-forget POST to registered webhook URLs
 */

const WebhookConfig = require('../models/WebhookConfig');

async function fireWebhook(eventType, payload) {
    try {
        const hooks = await WebhookConfig.find({ isActive: true, events: eventType });
        for (const hook of hooks) {
            try {
                const body = JSON.stringify({ event: eventType, timestamp: new Date().toISOString(), ...payload });
                const headers = { 'Content-Type': 'application/json' };
                if (hook.secret) headers['X-Webhook-Secret'] = hook.secret;

                // Use built-in fetch (Node 18+) or fallback
                if (typeof fetch !== 'undefined') {
                    fetch(hook.url, { method: 'POST', headers, body }).catch(() => {});
                }

                await hook.updateOne({ lastFired: new Date() });
            } catch (e) { /* individual hook error, continue */ }
        }
    } catch (e) { /* non-blocking */ }
}

module.exports = { fireWebhook };
