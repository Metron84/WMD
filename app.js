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
    volume: 0.75          // Volume level (0.0 - 1.0)
};

// ==================== Initialization ====================

/**
 * Initialize the application
 * WHY: Setting up event listeners in a dedicated init function keeps the code
 * organized and ensures all DOM elements are ready before attaching handlers
 */
function init() {
    setupDropZone();
    setupControls();
    setupAudioEvents();
    setupVolumeControl();
    registerServiceWorker();
    
    // Set initial volume
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

// ==================== Start Application ====================
document.addEventListener('DOMContentLoaded', init);
