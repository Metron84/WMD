/**
 * WMD Player - IndexedDB Storage Module
 * 
 * Provides persistent local storage for:
 * - Playlists with audio file blobs
 * - User preferences (volume, shuffle, last played)
 * 
 * Uses IndexedDB for large file storage (up to 50GB+ depending on device)
 * 
 * @version 1.0.0
 */

// ==================== Database Configuration ====================

const DB_NAME = 'wmd-player-db';
const DB_VERSION = 1;

const STORES = {
    PLAYLISTS: 'playlists',
    TRACKS: 'tracks',
    PREFERENCES: 'preferences'
};

let db = null;

// ==================== Database Initialization ====================

/**
 * Initialize the IndexedDB database
 * @returns {Promise<IDBDatabase>} The database instance
 */
async function initDB() {
    if (db) return db;
    
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        
        request.onerror = () => {
            console.error('Failed to open database:', request.error);
            reject(request.error);
        };
        
        request.onsuccess = () => {
            db = request.result;
            console.log('Database opened successfully');
            resolve(db);
        };
        
        request.onupgradeneeded = (event) => {
            const database = event.target.result;
            
            // Playlists store - metadata only
            if (!database.objectStoreNames.contains(STORES.PLAYLISTS)) {
                const playlistStore = database.createObjectStore(STORES.PLAYLISTS, { 
                    keyPath: 'id', 
                    autoIncrement: true 
                });
                playlistStore.createIndex('name', 'name', { unique: false });
                playlistStore.createIndex('createdAt', 'createdAt', { unique: false });
            }
            
            // Tracks store - holds audio blobs
            if (!database.objectStoreNames.contains(STORES.TRACKS)) {
                const trackStore = database.createObjectStore(STORES.TRACKS, { 
                    keyPath: 'id', 
                    autoIncrement: true 
                });
                trackStore.createIndex('playlistId', 'playlistId', { unique: false });
                trackStore.createIndex('order', 'order', { unique: false });
            }
            
            // Preferences store - single record for app state
            if (!database.objectStoreNames.contains(STORES.PREFERENCES)) {
                database.createObjectStore(STORES.PREFERENCES, { keyPath: 'key' });
            }
            
            console.log('Database schema created/upgraded');
        };
    });
}

// ==================== Playlist Operations ====================

/**
 * Save the current playlist with all audio files
 * 
 * @param {string} name - Name for the playlist
 * @param {Array} tracks - Array of track objects with {name, file, url}
 * @returns {Promise<number>} The saved playlist ID
 */
async function savePlaylist(name, tracks) {
    const database = await initDB();
    
    return new Promise((resolve, reject) => {
        const transaction = database.transaction([STORES.PLAYLISTS, STORES.TRACKS], 'readwrite');
        const playlistStore = transaction.objectStore(STORES.PLAYLISTS);
        const trackStore = transaction.objectStore(STORES.TRACKS);
        
        // Create playlist metadata
        const playlist = {
            name: name,
            trackCount: tracks.length,
            createdAt: new Date().toISOString(),
            totalSize: 0
        };
        
        // Add playlist first to get the ID
        const playlistRequest = playlistStore.add(playlist);
        
        playlistRequest.onsuccess = async () => {
            const playlistId = playlistRequest.result;
            let totalSize = 0;
            
            // Add each track with its audio blob
            for (let i = 0; i < tracks.length; i++) {
                const track = tracks[i];
                
                // Convert file to blob if needed
                const audioBlob = track.file instanceof Blob ? track.file : await fileToBlob(track.file);
                totalSize += audioBlob.size;
                
                const trackData = {
                    playlistId: playlistId,
                    name: track.name,
                    originalName: track.file.name,
                    order: i,
                    audioBlob: audioBlob,
                    size: audioBlob.size,
                    type: track.file.type || 'audio/mpeg'
                };
                
                trackStore.add(trackData);
            }
            
            // Update playlist with total size
            playlist.id = playlistId;
            playlist.totalSize = totalSize;
            playlistStore.put(playlist);
            
            console.log(`Saved playlist "${name}" with ${tracks.length} tracks (${formatBytes(totalSize)})`);
            resolve(playlistId);
        };
        
        playlistRequest.onerror = () => reject(playlistRequest.error);
        
        transaction.onerror = () => reject(transaction.error);
    });
}

/**
 * Load a playlist and its tracks from storage
 * 
 * @param {number} playlistId - The playlist ID to load
 * @returns {Promise<{playlist: Object, tracks: Array}>} Playlist data with tracks
 */
async function loadPlaylist(playlistId) {
    const database = await initDB();
    
    return new Promise((resolve, reject) => {
        const transaction = database.transaction([STORES.PLAYLISTS, STORES.TRACKS], 'readonly');
        const playlistStore = transaction.objectStore(STORES.PLAYLISTS);
        const trackStore = transaction.objectStore(STORES.TRACKS);
        
        const playlistRequest = playlistStore.get(playlistId);
        
        playlistRequest.onsuccess = () => {
            const playlist = playlistRequest.result;
            if (!playlist) {
                reject(new Error('Playlist not found'));
                return;
            }
            
            // Get all tracks for this playlist
            const index = trackStore.index('playlistId');
            const tracksRequest = index.getAll(playlistId);
            
            tracksRequest.onsuccess = () => {
                const tracks = tracksRequest.result;
                // Sort by order
                tracks.sort((a, b) => a.order - b.order);
                
                // Convert blobs to object URLs for playback
                const processedTracks = tracks.map((track, index) => ({
                    name: track.name,
                    originalName: track.originalName,
                    file: new File([track.audioBlob], track.originalName, { type: track.type }),
                    url: URL.createObjectURL(track.audioBlob),
                    index: index
                }));
                
                console.log(`Loaded playlist "${playlist.name}" with ${tracks.length} tracks`);
                resolve({ playlist, tracks: processedTracks });
            };
            
            tracksRequest.onerror = () => reject(tracksRequest.error);
        };
        
        playlistRequest.onerror = () => reject(playlistRequest.error);
    });
}

/**
 * Delete a playlist and all its tracks
 * 
 * @param {number} playlistId - The playlist ID to delete
 * @returns {Promise<void>}
 */
async function deletePlaylist(playlistId) {
    const database = await initDB();
    
    return new Promise((resolve, reject) => {
        const transaction = database.transaction([STORES.PLAYLISTS, STORES.TRACKS], 'readwrite');
        const playlistStore = transaction.objectStore(STORES.PLAYLISTS);
        const trackStore = transaction.objectStore(STORES.TRACKS);
        
        // Delete the playlist
        playlistStore.delete(playlistId);
        
        // Delete all tracks for this playlist
        const index = trackStore.index('playlistId');
        const tracksRequest = index.openCursor(IDBKeyRange.only(playlistId));
        
        tracksRequest.onsuccess = (event) => {
            const cursor = event.target.result;
            if (cursor) {
                cursor.delete();
                cursor.continue();
            }
        };
        
        transaction.oncomplete = () => {
            console.log(`Deleted playlist ${playlistId}`);
            resolve();
        };
        
        transaction.onerror = () => reject(transaction.error);
    });
}

/**
 * Get all saved playlists (metadata only, no tracks)
 * 
 * @returns {Promise<Array>} Array of playlist objects
 */
async function getAllPlaylists() {
    const database = await initDB();
    
    return new Promise((resolve, reject) => {
        const transaction = database.transaction(STORES.PLAYLISTS, 'readonly');
        const store = transaction.objectStore(STORES.PLAYLISTS);
        const request = store.getAll();
        
        request.onsuccess = () => {
            const playlists = request.result;
            // Sort by most recent first
            playlists.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
            resolve(playlists);
        };
        
        request.onerror = () => reject(request.error);
    });
}

// ==================== Preferences Operations ====================

/**
 * Save user preferences
 * 
 * @param {Object} prefs - Preferences object
 */
async function savePreferences(prefs) {
    const database = await initDB();
    
    return new Promise((resolve, reject) => {
        const transaction = database.transaction(STORES.PREFERENCES, 'readwrite');
        const store = transaction.objectStore(STORES.PREFERENCES);
        
        // Save each preference as a separate record for granular updates
        const entries = Object.entries(prefs);
        entries.forEach(([key, value]) => {
            store.put({ key, value, updatedAt: new Date().toISOString() });
        });
        
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
    });
}

/**
 * Load all user preferences
 * 
 * @returns {Promise<Object>} Preferences object
 */
async function loadPreferences() {
    const database = await initDB();
    
    return new Promise((resolve, reject) => {
        const transaction = database.transaction(STORES.PREFERENCES, 'readonly');
        const store = transaction.objectStore(STORES.PREFERENCES);
        const request = store.getAll();
        
        request.onsuccess = () => {
            const records = request.result;
            const prefs = {};
            records.forEach(record => {
                prefs[record.key] = record.value;
            });
            resolve(prefs);
        };
        
        request.onerror = () => reject(request.error);
    });
}

// ==================== Storage Info ====================

/**
 * Get storage usage estimate
 * 
 * @returns {Promise<{used: number, quota: number, percentage: number}>}
 */
async function getStorageInfo() {
    if ('storage' in navigator && 'estimate' in navigator.storage) {
        const estimate = await navigator.storage.estimate();
        return {
            used: estimate.usage || 0,
            quota: estimate.quota || 0,
            percentage: estimate.quota ? Math.round((estimate.usage / estimate.quota) * 100) : 0
        };
    }
    return { used: 0, quota: 0, percentage: 0 };
}

/**
 * Request persistent storage (prevents browser from clearing data)
 * 
 * @returns {Promise<boolean>} Whether persistent storage was granted
 */
async function requestPersistentStorage() {
    if ('storage' in navigator && 'persist' in navigator.storage) {
        const isPersisted = await navigator.storage.persisted();
        if (!isPersisted) {
            return await navigator.storage.persist();
        }
        return true;
    }
    return false;
}

// ==================== Utilities ====================

/**
 * Convert a File to a Blob
 * @param {File} file 
 * @returns {Promise<Blob>}
 */
async function fileToBlob(file) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => {
            resolve(new Blob([reader.result], { type: file.type }));
        };
        reader.readAsArrayBuffer(file);
    });
}

/**
 * Format bytes to human readable string
 * @param {number} bytes 
 * @returns {string}
 */
function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// ==================== Export Storage API ====================

const Storage = {
    init: initDB,
    savePlaylist,
    loadPlaylist,
    deletePlaylist,
    getAllPlaylists,
    savePreferences,
    loadPreferences,
    getStorageInfo,
    requestPersistentStorage,
    formatBytes
};

// Make available globally
window.WMDStorage = Storage;
