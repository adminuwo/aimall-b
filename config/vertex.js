const { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } = require('@google/generative-ai');
const { VertexAI } = require('@google-cloud/vertexai');
require('dotenv').config(); 
const path = require('path');
const { AISA_CONVERSATIONAL_RULES, BRAND_SYSTEM_RULES } = require('../utils/brandIdentity.js');
const { getConfig, getFullSystemInstruction } = require('../services/configService.js');

// Dual-mode initialization: Try Gemini API Key first, fallback to Vertex AI
const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
const projectId = process.env.GCP_PROJECT_ID;
// Corrected to 'asia-south1' as requested ('aisa' typo fixed)
const location = process.env.GCP_LOCATION || 'asia-south1';
const keyFilePath = path.join(__dirname, '../google_cloud_credentials.json');

let genAI;
let vertexAI;
let useVertexAI = false;

// Try Gemini API Key first (simpler, more portable)
if (apiKey) {
    console.log(`✅ Gemini AI initializing with API Key`);
    genAI = new GoogleGenerativeAI(apiKey);
    useVertexAI = false;
}
// Fallback to Vertex AI with service account
else if (projectId) {
    console.log(`✅ Vertex AI initializing with project: ${projectId}`);
    try {
        vertexAI = new VertexAI({ project: projectId, location: location });
        useVertexAI = true;
    } catch (e) {
        console.error('❌ Vertex AI initialization failed:', e.message);
    }
} else {
    console.error("❌ Error: Neither GOOGLE_API_KEY nor GCP_PROJECT_ID found in environment variables.");
}

// Model name - Official stable Vertex AI Flash model
const modelName = process.env.AI_MODEL_NAME || "gemini-2.5-flash"; 

/**
 * Lazy Model Initialization
 * Returns a generative model from the best available source
 */
const getGenerativeModel = (config = { maxOutputTokens: 4096 }) => {
    try {
        const current_apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
        const current_projectId = process.env.GCP_PROJECT_ID;
        const current_location = process.env.GCP_LOCATION || 'asia-south1';

        if (current_apiKey) {
            const client = new GoogleGenerativeAI(current_apiKey);
            return client.getGenerativeModel({
                model: modelName,
                systemInstruction: getFullSystemInstruction(),
                ...config
            });
        } else if (current_projectId) {
            const { VertexAI } = require('@google-cloud/vertexai');
            const vAI = new VertexAI({ project: current_projectId, location: current_location });
            return vAI.getGenerativeModel({
                model: modelName,
                systemInstruction: getFullSystemInstruction(),
                ...config
            });
        }
    } catch (e) {
        console.error('❌ AI Model lazy-init failed:', e.message);
    }
    return null;
};

// Initial placeholder (lazy loaded)
const generativeModel = {
    startChat: (options) => {
        const model = getGenerativeModel();
        if (!model) throw new Error("AI not initialized. Check credentials in .env");
        return model.startChat(options);
    },
    generateContent: (options) => {
        const model = getGenerativeModel();
        if (!model) throw new Error("AI not initialized.");
        return model.generateContent(options);
    },
    sendMessageStream: (options) => {
        const model = getGenerativeModel();
        if (!model) throw new Error("AI not initialized.");
        return model.sendMessageStream(options);
    }
};

/**
 * Dynamic System Instruction Getter
 * Returns the latest rules from MongoDB (or defaults)
 */
const getDynamicSystemInstruction = () => {
    return getFullSystemInstruction();
};

const systemInstructionText = getFullSystemInstruction();

// Export genAI instance for multi-model support in chatRoutes
const genAIInstance = generativeModel;

module.exports = {
    modelName,
    generativeModel,
    genAIInstance,
    vertexAI,
    getDynamicSystemInstruction
};