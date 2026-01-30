/**
 * WMD Player - Main Application Script
 * 
 * This MP3 player uses the Web Audio API for playback with a focus on:
 * - Clean, maintainable code structure
 * - Smooth volume control using the 'input' event for real-time updates
 * - Fisher-Yates shuffle algorithm for true random playlist ordering
 * - Proper 'ended' event handling for seamless track transitions
 * 
 * @author WMD Player
 * @version 1.0.0
 */

// ==================== DOM Elements ====================
const elements = {
    // Drop zone and file input
    dropZone: document.getElementById('dropZone'),
    folderInput: document.getElementById('folderInput'),

    // Track info displays
    trackCounter: document.getElementById('trackCounter'),
    trackTitle: document.getElementById('trackTitle'),
    trackArtist: document.getElementById('trackArtist'),

    // Progress controls
    currentTime: document.getElementById('currentTime'),
    duration: document.getElementById('duration'),
    progressFill: document.getElementById('progressFill'),
    progressInput: document.getElementById('progressInput'),

    // Playback controls
    playBtn: document.getElementById('playBtn'),
    prevBtn: document.getElementById('prevBtn'),
    nextBtn: document.getElementById('nextBtn'),
    shuffleBtn: document.getElementById('shuffleBtn'),

    // Volume controls
    volumeBtn: document.getElementById('volumeBtn'),
    volumeSlider: document.getElementById('volumeSlider'),

    // Playlist
    playlist: document.getElementById('playlist'),
    playlistCount: document.getElementById('playlistCount'),
    playlistContainer: document.getElementById('playlistContainer'),

    // Saved Playlists
    savedPlaylists: document.getElementById('savedPlaylists'),
    savedPlaylistList: document.getElementById('savedPlaylistList'),
    savePlaylistBtn: document.getElementById('savePlaylistBtn'),
    storageInfo: document.getElementById('storageInfo'),
    emptyPlaylists: document.getElementById('emptyPlaylists'),

    // Audio element - WHY: Using native HTMLAudioElement for broad browser support
    // and simple, reliable playback without complex audio context setup
    audio: document.getElementById('audioPlayer')
};

// ==================== Application State ====================
const state = {
    tracks: [],           // Array of loaded track objects {name, file, url}
    currentIndex: 0,      // Index of currently playing track
    isPlaying: false,     // Playback state
    shuffleMode: false,   // Shuffle toggle state
    shuffledOrder: [],    // Array of shuffled indices for shuffle mode
    shuffledIndex: 0,     // Current position in shuffled order
    volume: 0.75,         // Volume level (0.0 - 1.0)
    currentPlaylistId: null,  // ID of currently loaded saved playlist
    savedPlaylists: []    // Cache of saved playlists metadata
};

// ==================== Initialization ====================

/**
 * Initialize the application
 * WHY: Setting up event listeners in a dedicated init function keeps the code
 * organized and ensures all DOM elements are ready before attaching handlers
 */
async function init() {
    setupDropZone();
    setupControls();
    setupAudioEvents();
    setupVolumeControl();
    setupKeyboardShortcuts();
    setupSavedPlaylists();
    registerServiceWorker();

    // Initialize storage and load preferences
    await initializeStorage();

    // Set initial volume (may be overridden by preferences)
    elements.audio.volume = state.volume;
    elements.volumeSlider.value = state.volume * 100;
}

// ==================== File Loading ====================

/**
 * Set up drag-and-drop and click handlers for folder selection
 * WHY: Supporting both drag-drop and click provides flexibility for users
 * with different interaction preferences
 */
function setupDropZone() {
    const { dropZone, folderInput } = elements;

    // Click to open file picker
    dropZone.addEventListener('click', () => folderInput.click());

    // File input change handler
    folderInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            loadFiles(Array.from(e.target.files));
        }
    });

    // Drag events - WHY: Using dragover and dragleave for visual feedback
    // helps users understand when the drop zone is active
    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('dragover');
    });

    dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('dragover');
    });

    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');

        // WHY: DataTransferItemList.webkitGetAsEntry() allows reading directory contents
        // This is the standard way to handle folder drops in modern browsers
        const items = Array.from(e.dataTransfer.items);
        const files = [];

        // Process dropped items
        const processEntry = (entry) => {
            return new Promise((resolve) => {
                if (entry.isFile) {
                    entry.file((file) => {
                        if (file.type.startsWith('audio/') || file.name.endsWith('.mp3')) {
                            files.push(file);
                        }
                        resolve();
                    });
                } else if (entry.isDirectory) {
                    const reader = entry.createReader();
                    reader.readEntries(async (entries) => {
                        for (const subEntry of entries) {
                            await processEntry(subEntry);
                        }
                        resolve();
                    });
                } else {
                    resolve();
                }
            });
        };

        Promise.all(
            items
                .filter(item => item.kind === 'file')
                .map(item => {
                    const entry = item.webkitGetAsEntry();
                    return entry ? processEntry(entry) : Promise.resolve();
                })
        ).then(() => {
            if (files.length > 0) {
                loadFiles(files);
            }
        });
    });
}

/**
 * Load audio files into the playlist
 * WHY: We filter for MP3 files and sort alphabetically to provide
 * a consistent, predictable playlist order
 * 
 * @param {File[]} files - Array of File objects from input or drop
 */
function loadFiles(files) {
    // Filter for audio files only
    const audioFiles = files.filter(file =>
        file.type.startsWith('audio/') || file.name.endsWith('.mp3')
    );

    if (audioFiles.length === 0) {
        alert('No audio files found in the selected folder.');
        return;
    }

    // Sort files alphabetically by name
    audioFiles.sort((a, b) => a.name.localeCompare(b.name));

    // WHY: URL.createObjectURL creates a temporary URL that points to the file
    // This allows us to play local files without uploading them anywhere
    state.tracks = audioFiles.map((file, index) => ({
        name: cleanTrackName(file.name),
        file: file,
        url: URL.createObjectURL(file),
        index: index
    }));

    // Update UI
    elements.trackCounter.textContent = `${state.tracks.length} tracks`;
    elements.playlistCount.textContent = `${state.tracks.length} tracks`;

    // Hide drop zone after loading
    elements.dropZone.classList.add('hidden');

    // Render playlist
    renderPlaylist();

    // Initialize shuffle order if shuffle is enabled
    if (state.shuffleMode) {
        generateShuffledOrder();
    }

    // Enable save button
    elements.savePlaylistBtn.disabled = false;

    // Clear current saved playlist ID (this is a new unsaved playlist)
    state.currentPlaylistId = null;

    // Load first track (but don't play yet)
    loadTrack(0);
}

/**
 * Clean track name by removing file extension and common prefixes
 * WHY: Displaying cleaner track names improves readability
 * 
 * @param {string} filename - Original filename
 * @returns {string} Cleaned track name
 */
function cleanTrackName(filename) {
    return filename
        .replace(/\.(mp3|wav|ogg|m4a|flac)$/i, '')  // Remove extension
        .replace(/^\d+[\.\-\s]+/, '');                // Remove leading track numbers
}

// ==================== Playlist Rendering ====================

/**
 * Render the playlist UI
 * WHY: Rebuilding the playlist on each load ensures accurate state
 * and avoids complex diffing logic for this simple use case
 */
function renderPlaylist() {
    const { playlist } = elements;
    playlist.innerHTML = '';

    state.tracks.forEach((track, index) => {
        const li = document.createElement('li');
        li.className = 'playlist-item';
        li.tabIndex = 0;  // Make focusable for keyboard navigation

        li.innerHTML = `
            <span class="track-number">${String(index + 1).padStart(2, '0')}</span>
            <span class="item-title">${track.name}</span>
        `;

        // Click to play track
        li.addEventListener('click', () => playTrack(index));

        // Keyboard support
        li.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                playTrack(index);
            }
        });

        playlist.appendChild(li);
    });
}

/**
 * Update playlist highlighting to show current track
 * WHY: Visual feedback helps users quickly identify the playing track
 */
function updatePlaylistHighlight() {
    const items = elements.playlist.querySelectorAll('.playlist-item');
    items.forEach((item, index) => {
        item.classList.toggle('active', index === state.currentIndex);
    });

    // Scroll active item into view
    const activeItem = items[state.currentIndex];
    if (activeItem) {
        activeItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
}

// ==================== Playback Controls ====================

/**
 * Set up playback control button handlers
 */
function setupControls() {
    const { playBtn, prevBtn, nextBtn, shuffleBtn, progressInput } = elements;

    playBtn.addEventListener('click', togglePlayPause);
    prevBtn.addEventListener('click', playPrevious);
    nextBtn.addEventListener('click', playNext);
    shuffleBtn.addEventListener('click', toggleShuffle);

    // WHY: Using 'input' event instead of 'change' allows real-time seeking
    // as the user drags the progress slider
    progressInput.addEventListener('input', handleSeek);
}

/**
 * Toggle between play and pause states
 * WHY: Single button for play/pause is standard UX for media players
 */
function togglePlayPause() {
    if (state.tracks.length === 0) return;

    if (state.isPlaying) {
        pause();
    } else {
        play();
    }
}

/**
 * Start audio playback
 * WHY: Separating play() and pause() into distinct functions provides
 * clear, single-responsibility methods
 */
function play() {
    elements.audio.play()
        .then(() => {
            state.isPlaying = true;
            updatePlayPauseButton();
            updateMediaSessionState();
        })
        .catch(error => {
            // WHY: Browsers may block autoplay - this catches that error gracefully
            console.error('Playback failed:', error);
        });
}

/**
 * Pause audio playback
 */
function pause() {
    elements.audio.pause();
    state.isPlaying = false;
    updatePlayPauseButton();
    updateMediaSessionState();
}

/**
 * Update play/pause button icon based on state
 */
function updatePlayPauseButton() {
    const playIcon = elements.playBtn.querySelector('.play-icon');
    const pauseIcon = elements.playBtn.querySelector('.pause-icon');

    playIcon.style.display = state.isPlaying ? 'none' : 'block';
    pauseIcon.style.display = state.isPlaying ? 'block' : 'none';
}

/**
 * Load a specific track by index
 * WHY: Centralizing track loading ensures consistent state updates
 * 
 * @param {number} index - Track index to load
 */
function loadTrack(index) {
    if (index < 0 || index >= state.tracks.length) return;

    const track = state.tracks[index];
    state.currentIndex = index;

    // WHY: Setting audio.src triggers the browser to load the audio file
    elements.audio.src = track.url;

    // Update display
    elements.trackTitle.textContent = track.name;
    elements.trackArtist.textContent = `Track ${index + 1} of ${state.tracks.length}`;

    updatePlaylistHighlight();
    updateMediaSession();
    savePreferencesDebounced();
}

/**
 * Play a specific track by index
 * 
 * @param {number} index - Track index to play
 */
function playTrack(index) {
    const wasPlaying = state.isPlaying;
    loadTrack(index);

    // If shuffle is on, update the shuffled index to match
    if (state.shuffleMode) {
        state.shuffledIndex = state.shuffledOrder.indexOf(index);
    }

    // Start playing if we were playing before, or this is a user-initiated action
    play();
}

/**
 * Play the next track
 * WHY: Next track behavior depends on shuffle state - this function
 * handles both sequential and shuffled progression
 */
function playNext() {
    if (state.tracks.length === 0) return;

    let nextIndex;

    if (state.shuffleMode) {
        // Move to next position in shuffled order
        state.shuffledIndex = (state.shuffledIndex + 1) % state.shuffledOrder.length;
        nextIndex = state.shuffledOrder[state.shuffledIndex];
    } else {
        // Sequential: wrap around to beginning
        nextIndex = (state.currentIndex + 1) % state.tracks.length;
    }

    playTrack(nextIndex);
}

/**
 * Play the previous track
 */
function playPrevious() {
    if (state.tracks.length === 0) return;

    // WHY: If we're more than 3 seconds into the track, restart it instead
    // This matches standard media player behavior
    if (elements.audio.currentTime > 3) {
        elements.audio.currentTime = 0;
        return;
    }

    let prevIndex;

    if (state.shuffleMode) {
        // Move to previous position in shuffled order
        state.shuffledIndex = (state.shuffledIndex - 1 + state.shuffledOrder.length) % state.shuffledOrder.length;
        prevIndex = state.shuffledOrder[state.shuffledIndex];
    } else {
        // Sequential: wrap around to end
        prevIndex = (state.currentIndex - 1 + state.tracks.length) % state.tracks.length;
    }

    playTrack(prevIndex);
}

// ==================== Shuffle Logic ====================

/**
 * Toggle shuffle mode
 * WHY: Shuffle allows users to hear tracks in random order,
 * which can make listening more interesting
 */
function toggleShuffle() {
    state.shuffleMode = !state.shuffleMode;
    elements.shuffleBtn.classList.toggle('active', state.shuffleMode);

    if (state.shuffleMode && state.tracks.length > 0) {
        generateShuffledOrder();
        // Set shuffled index to current track's position in shuffled order
        state.shuffledIndex = state.shuffledOrder.indexOf(state.currentIndex);
    }

    savePreferencesDebounced();
}

/**
 * Generate a shuffled order of track indices using Fisher-Yates algorithm
 * 
 * WHY: Fisher-Yates provides a truly random, unbiased shuffle in O(n) time.
 * Unlike naive approaches (like sorting with random comparators), Fisher-Yates
 * guarantees each permutation has equal probability.
 * 
 * Algorithm:
 * 1. Start with an array of indices [0, 1, 2, ..., n-1]
 * 2. For each position from the end to the beginning:
 *    - Pick a random element from the unshuffled portion
 *    - Swap it with the current position
 * 3. Result: a uniformly random permutation
 */
function generateShuffledOrder() {
    // Create array of indices
    state.shuffledOrder = state.tracks.map((_, i) => i);

    // Fisher-Yates shuffle
    for (let i = state.shuffledOrder.length - 1; i > 0; i--) {
        // WHY: Math.floor(Math.random() * (i + 1)) gives uniform random int in [0, i]
        const j = Math.floor(Math.random() * (i + 1));
        // Swap elements
        [state.shuffledOrder[i], state.shuffledOrder[j]] =
            [state.shuffledOrder[j], state.shuffledOrder[i]];
    }

    // Start from beginning of shuffled order
    state.shuffledIndex = 0;
}

// ==================== Audio Events ====================

/**
 * Set up audio element event listeners
 * WHY: These events are essential for updating the UI in sync with playback
 */
function setupAudioEvents() {
    const { audio } = elements;

    // WHY: 'timeupdate' fires ~4 times per second during playback
    // Perfect frequency for smooth progress bar updates
    audio.addEventListener('timeupdate', updateProgress);

    // WHY: 'loadedmetadata' fires when duration becomes available
    // We need this to display total track duration
    audio.addEventListener('loadedmetadata', () => {
        elements.duration.textContent = formatTime(audio.duration);
        elements.progressInput.max = Math.floor(audio.duration);
    });

    // WHY: 'ended' fires when track finishes - this is where we handle
    // auto-advancing to the next track (respecting shuffle mode)
    audio.addEventListener('ended', handleTrackEnded);

    // Update play state if audio is paused externally (e.g., by system)
    audio.addEventListener('pause', () => {
        state.isPlaying = false;
        updatePlayPauseButton();
    });

    audio.addEventListener('play', () => {
        state.isPlaying = true;
        updatePlayPauseButton();
    });
}

/**
 * Handle end of track event
 * 
 * WHY: This is a critical handler that determines what happens after a track
 * finishes. It respects the shuffle mode and advances appropriately.
 */
function handleTrackEnded() {
    // Automatically play next track
    playNext();
}

/**
 * Update progress bar and time display
 */
function updateProgress() {
    const { audio, progressFill, progressInput, currentTime } = elements;

    if (audio.duration) {
        const percent = (audio.currentTime / audio.duration) * 100;
        progressFill.style.width = `${percent}%`;
        progressInput.value = audio.currentTime;
        currentTime.textContent = formatTime(audio.currentTime);
    }
}

/**
 * Handle seeking via progress slider
 * 
 * @param {Event} e - Input event from progress slider
 */
function handleSeek(e) {
    const seekTime = parseFloat(e.target.value);
    elements.audio.currentTime = seekTime;
}

// ==================== Volume Control ====================

/**
 * Set up volume slider and mute button
 * 
 * WHY: Using 'input' event (not 'change') ensures the volume updates
 * in real-time as the user drags the slider, not just when they release
 */
function setupVolumeControl() {
    const { volumeSlider, volumeBtn, audio } = elements;

    // Real-time volume adjustment
    volumeSlider.addEventListener('input', (e) => {
        const value = e.target.value / 100;
        audio.volume = value;
        state.volume = value;
        updateVolumeIcon();
        savePreferencesDebounced();
    });

    // Click volume button to toggle mute
    volumeBtn.addEventListener('click', toggleMute);
}

/**
 * Toggle mute state
 */
function toggleMute() {
    const { audio, volumeSlider } = elements;

    if (audio.volume > 0) {
        // Mute - store current volume and set to 0
        state.volume = audio.volume;
        audio.volume = 0;
        volumeSlider.value = 0;
    } else {
        // Unmute - restore previous volume
        audio.volume = state.volume || 0.75;
        volumeSlider.value = audio.volume * 100;
    }

    updateVolumeIcon();
    savePreferencesDebounced();
}

/**
 * Update volume icon based on current level
 */
function updateVolumeIcon() {
    const volumeHigh = elements.volumeBtn.querySelector('.volume-high');
    const volumeMuted = elements.volumeBtn.querySelector('.volume-muted');

    const isMuted = elements.audio.volume === 0;
    volumeHigh.style.display = isMuted ? 'none' : 'block';
    volumeMuted.style.display = isMuted ? 'block' : 'none';
}

// ==================== Utilities ====================

/**
 * Format time in seconds to MM:SS display
 * WHY: Human-readable time format is essential for usability
 * 
 * @param {number} seconds - Time in seconds
 * @returns {string} Formatted time string
 */
function formatTime(seconds) {
    if (!seconds || isNaN(seconds)) return '0:00';

    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// ==================== Service Worker ====================

/**
 * Register the service worker for PWA functionality
 * WHY: Service workers enable offline caching and make the app installable
 */
function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('./sw.js')
                .then(registration => {
                    console.log('ServiceWorker registered:', registration.scope);
                })
                .catch(error => {
                    console.log('ServiceWorker registration failed:', error);
                });
        });
    }
}

// ==================== Storage Integration ====================

/**
 * Initialize storage and load saved preferences
 */
async function initializeStorage() {
    try {
        // Initialize the database
        await WMDStorage.init();

        // Request persistent storage
        await WMDStorage.requestPersistentStorage();

        // Load saved preferences
        const prefs = await WMDStorage.loadPreferences();
        if (prefs.volume !== undefined) {
            state.volume = prefs.volume;
            elements.audio.volume = state.volume;
            elements.volumeSlider.value = state.volume * 100;
            updateVolumeIcon();
        }
        if (prefs.shuffleMode !== undefined) {
            state.shuffleMode = prefs.shuffleMode;
            elements.shuffleBtn.classList.toggle('active', state.shuffleMode);
        }

        // Load saved playlists
        await refreshSavedPlaylists();

        // Update storage info
        await updateStorageInfo();

        console.log('Storage initialized successfully');
    } catch (error) {
        console.error('Failed to initialize storage:', error);
    }
}

/**
 * Update the storage usage display
 */
async function updateStorageInfo() {
    try {
        const info = await WMDStorage.getStorageInfo();
        if (info.quota > 0) {
            elements.storageInfo.textContent = `${WMDStorage.formatBytes(info.used)} used`;
        }
    } catch (error) {
        console.error('Failed to get storage info:', error);
    }
}

/**
 * Save current preferences (debounced)
 */
let preferenceSaveTimeout = null;
function savePreferencesDebounced() {
    clearTimeout(preferenceSaveTimeout);
    preferenceSaveTimeout = setTimeout(async () => {
        try {
            await WMDStorage.savePreferences({
                volume: state.volume,
                shuffleMode: state.shuffleMode,
                lastTrackIndex: state.currentIndex
            });
        } catch (error) {
            console.error('Failed to save preferences:', error);
        }
    }, 1000);
}

// ==================== Saved Playlists Management ====================

/**
 * Set up saved playlists event handlers
 */
function setupSavedPlaylists() {
    elements.savePlaylistBtn.addEventListener('click', saveCurrentPlaylist);
}

/**
 * Refresh the saved playlists display
 */
async function refreshSavedPlaylists() {
    try {
        state.savedPlaylists = await WMDStorage.getAllPlaylists();
        renderSavedPlaylists();
    } catch (error) {
        console.error('Failed to load saved playlists:', error);
    }
}

/**
 * Render the saved playlists list
 */
function renderSavedPlaylists() {
    const list = elements.savedPlaylistList;

    if (state.savedPlaylists.length === 0) {
        elements.emptyPlaylists.style.display = 'block';
        // Keep only empty state
        Array.from(list.children).forEach(child => {
            if (child !== elements.emptyPlaylists) {
                child.remove();
            }
        });
        return;
    }

    elements.emptyPlaylists.style.display = 'none';

    // Clear existing items (except empty state)
    Array.from(list.children).forEach(child => {
        if (child !== elements.emptyPlaylists) {
            child.remove();
        }
    });

    // Render each playlist
    state.savedPlaylists.forEach(playlist => {
        const item = document.createElement('div');
        item.className = 'saved-playlist-item';
        item.dataset.playlistId = playlist.id;

        const date = new Date(playlist.createdAt);
        const dateStr = date.toLocaleDateString(undefined, {
            month: 'short',
            day: 'numeric'
        });

        item.innerHTML = `
            <div class="playlist-item-info">
                <div class="playlist-item-name">${escapeHtml(playlist.name)}</div>
                <div class="playlist-item-meta">${playlist.trackCount} tracks • ${WMDStorage.formatBytes(playlist.totalSize)} • ${dateStr}</div>
            </div>
            <div class="playlist-item-actions">
                <button class="playlist-action-btn load-btn" title="Load playlist">
                    <svg viewBox="0 0 24 24" fill="currentColor">
                        <path d="M8 5v14l11-7z"/>
                    </svg>
                </button>
                <button class="playlist-action-btn delete-btn" title="Delete playlist">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
                    </svg>
                </button>
            </div>
        `;

        // Load button
        item.querySelector('.load-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            loadSavedPlaylist(playlist.id);
        });

        // Delete button
        item.querySelector('.delete-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            deleteSavedPlaylist(playlist.id, playlist.name);
        });

        // Click on item also loads
        item.addEventListener('click', () => loadSavedPlaylist(playlist.id));

        list.appendChild(item);
    });
}

/**
 * Save the current playlist
 */
async function saveCurrentPlaylist() {
    if (state.tracks.length === 0) return;

    const name = prompt('Enter a name for this playlist:', `Playlist ${new Date().toLocaleDateString()}`);
    if (!name) return;

    const btn = elements.savePlaylistBtn;
    const originalText = btn.innerHTML;
    btn.innerHTML = '<div class="loading-spinner"></div> Saving...';
    btn.disabled = true;

    try {
        await WMDStorage.savePlaylist(name, state.tracks);
        await refreshSavedPlaylists();
        await updateStorageInfo();

        // Brief success indication
        btn.innerHTML = '✓ Saved!';
        setTimeout(() => {
            btn.innerHTML = originalText;
            btn.disabled = false;
        }, 1500);
    } catch (error) {
        console.error('Failed to save playlist:', error);
        alert('Failed to save playlist. Storage may be full.');
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}

/**
 * Load a saved playlist
 */
async function loadSavedPlaylist(playlistId) {
    const item = document.querySelector(`[data-playlist-id="${playlistId}"]`);
    if (item) item.classList.add('loading');

    try {
        const { playlist, tracks } = await WMDStorage.loadPlaylist(playlistId);

        // Update state
        state.tracks = tracks;
        state.currentPlaylistId = playlistId;
        state.currentIndex = 0;

        // Update UI
        elements.trackCounter.textContent = `${tracks.length} tracks`;
        elements.playlistCount.textContent = `${tracks.length} tracks`;
        elements.dropZone.classList.add('hidden');

        // Render and initialize
        renderPlaylist();

        if (state.shuffleMode) {
            generateShuffledOrder();
        }

        loadTrack(0);
        updateMediaSession();

        console.log(`Loaded saved playlist: ${playlist.name}`);
    } catch (error) {
        console.error('Failed to load playlist:', error);
        alert('Failed to load playlist.');
    } finally {
        if (item) item.classList.remove('loading');
    }
}

/**
 * Delete a saved playlist
 */
async function deleteSavedPlaylist(playlistId, name) {
    if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;

    try {
        await WMDStorage.deletePlaylist(playlistId);
        await refreshSavedPlaylists();
        await updateStorageInfo();

        // If this was the currently loaded playlist, clear it
        if (state.currentPlaylistId === playlistId) {
            state.currentPlaylistId = null;
        }
    } catch (error) {
        console.error('Failed to delete playlist:', error);
        alert('Failed to delete playlist.');
    }
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ==================== Media Session API ====================

/**
 * Set up and update Media Session for lock screen controls
 * WHY: Media Session API allows control from lock screen, notifications,
 * and media keys on mobile and desktop
 */
function updateMediaSession() {
    if (!('mediaSession' in navigator)) return;

    const track = state.tracks[state.currentIndex];
    if (!track) return;

    navigator.mediaSession.metadata = new MediaMetadata({
        title: track.name,
        artist: `Track ${state.currentIndex + 1} of ${state.tracks.length}`,
        album: 'WMD Player',
        artwork: [
            { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: 'icon-512.png', sizes: '512x512', type: 'image/png' }
        ]
    });

    // Set up action handlers
    navigator.mediaSession.setActionHandler('play', play);
    navigator.mediaSession.setActionHandler('pause', pause);
    navigator.mediaSession.setActionHandler('previoustrack', playPrevious);
    navigator.mediaSession.setActionHandler('nexttrack', playNext);

    navigator.mediaSession.setActionHandler('seekto', (details) => {
        if (details.seekTime !== undefined) {
            elements.audio.currentTime = details.seekTime;
        }
    });

    navigator.mediaSession.setActionHandler('seekbackward', (details) => {
        const skipTime = details.seekOffset || 10;
        elements.audio.currentTime = Math.max(elements.audio.currentTime - skipTime, 0);
    });

    navigator.mediaSession.setActionHandler('seekforward', (details) => {
        const skipTime = details.seekOffset || 10;
        elements.audio.currentTime = Math.min(elements.audio.currentTime + skipTime, elements.audio.duration);
    });
}

/**
 * Update Media Session playback state
 */
function updateMediaSessionState() {
    if (!('mediaSession' in navigator)) return;

    navigator.mediaSession.playbackState = state.isPlaying ? 'playing' : 'paused';

    // Update position state for seek bar on lock screen
    if (elements.audio.duration && !isNaN(elements.audio.duration)) {
        navigator.mediaSession.setPositionState({
            duration: elements.audio.duration,
            playbackRate: elements.audio.playbackRate,
            position: elements.audio.currentTime
        });
    }
}

// ==================== Keyboard Shortcuts ====================

/**
 * Set up keyboard shortcuts for playback control
 * WHY: Power users expect keyboard controls for efficiency
 */
function setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
        // Ignore if typing in an input
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

        switch (e.code) {
            case 'Space':
                e.preventDefault();
                togglePlayPause();
                break;
            case 'ArrowLeft':
                if (e.shiftKey) {
                    // Seek back 10 seconds
                    elements.audio.currentTime = Math.max(elements.audio.currentTime - 10, 0);
                } else {
                    playPrevious();
                }
                break;
            case 'ArrowRight':
                if (e.shiftKey) {
                    // Seek forward 10 seconds
                    elements.audio.currentTime = Math.min(elements.audio.currentTime + 10, elements.audio.duration || 0);
                } else {
                    playNext();
                }
                break;
            case 'ArrowUp':
                e.preventDefault();
                adjustVolume(0.05);
                break;
            case 'ArrowDown':
                e.preventDefault();
                adjustVolume(-0.05);
                break;
            case 'KeyM':
                toggleMute();
                break;
            case 'KeyS':
                toggleShuffle();
                break;
        }
    });
}

/**
 * Adjust volume by a delta amount
 */
function adjustVolume(delta) {
    const newVolume = Math.max(0, Math.min(1, state.volume + delta));
    state.volume = newVolume;
    elements.audio.volume = newVolume;
    elements.volumeSlider.value = newVolume * 100;
    updateVolumeIcon();
    savePreferencesDebounced();
}

// ==================== Start Application ====================
document.addEventListener('DOMContentLoaded', init);
