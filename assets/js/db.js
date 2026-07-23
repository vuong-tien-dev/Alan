/* ==========================================
   IndexedDB - Conversation Storage
   ========================================== */

const DB_NAME = 'alan_chat';
const DB_VERSION = 1;
const STORE_NAME = 'conversations';

let db = null;

// Open database
async function openDB() {
    if (db) return db;

    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
            db = request.result;
            resolve(db);
        };

        request.onupgradeneeded = (e) => {
            const database = e.target.result;
            if (!database.objectStoreNames.contains(STORE_NAME)) {
                const store = database.createObjectStore(STORE_NAME, { keyPath: 'id' });
                store.createIndex('time_created', 'time_created', { unique: false });
            }
        };
    });
}

// Save conversation
async function saveConversation(conversation) {
    const database = await openDB();
    return new Promise((resolve, reject) => {
        const tx = database.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const request = store.put(conversation);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

// Get conversation by ID
async function getConversation(id) {
    const database = await openDB();
    return new Promise((resolve, reject) => {
        const tx = database.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const request = store.get(id);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

// Get all conversations (sorted by time_created desc)
async function getAllConversations() {
    const database = await openDB();
    return new Promise((resolve, reject) => {
        const tx = database.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const request = store.getAll();
        request.onsuccess = () => {
            const results = request.result || [];
            // Sort by time_created descending (newest first)
            results.sort((a, b) => new Date(b.time_created) - new Date(a.time_created));
            resolve(results);
        };
        request.onerror = () => reject(request.error);
    });
}

// Delete conversation
async function deleteConversation(id) {
    const database = await openDB();
    return new Promise((resolve, reject) => {
        const tx = database.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const request = store.delete(id);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

// Delete all conversations
async function clearAllConversations() {
    const database = await openDB();
    return new Promise((resolve, reject) => {
        const tx = database.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const request = store.clear();
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

// Auto-save current conversation (debounced)
let saveTimeout = null;
function autoSaveConversation(conv) {
    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(async () => {
        try {
            await saveConversation(conv);
            console.log('💾 Conversation saved:', conv.id);
        } catch (e) {
            console.error('Failed to save conversation:', e);
        }
    }, 500); // Debounce 500ms
}

console.log('📦 IndexedDB module loaded');
