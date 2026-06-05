// Initialize socket connection
const socket = io();

// Local States
let myId = null;
let myRole = 'Guest';
let myNickname = '';
let currentPlaylist = [];
let currentVideoPlaying = null;
let isPlayingState = false;
let currentVolume = 100;
let searchTimeout = null;
let dragStartIndex = null;
let currentVideoDuration = 0;
let lastKnownProgressTime = 0;
let lastKnownProgressPercent = 0;
let lastActiveVideoId = null;

// Persistent User ID (keeps Master role if refreshed)
let myUserId = localStorage.getItem('party_user_id');
if (!myUserId) {
  myUserId = 'uid_' + Math.random().toString(36).substring(2, 11);
  localStorage.setItem('party_user_id', myUserId);
}

// Local Storage for Favorites and History
let myFavorites = JSON.parse(localStorage.getItem('party_favorites') || '[]');
let myHistory = JSON.parse(localStorage.getItem('party_history') || '[]');

function saveFavorites() {
  localStorage.setItem('party_favorites', JSON.stringify(myFavorites));
}
function saveHistory() {
  localStorage.setItem('party_history', JSON.stringify(myHistory));
}

// Helper to refresh Lucide icons
function refreshIcons() {
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

// Helper to replace an icon in the DOM cleanly
function replaceIcon(elementId, newIconName) {
  const el = document.getElementById(elementId);
  if (!el) return;
  
  const newEl = document.createElement('i');
  newEl.id = elementId;
  newEl.setAttribute('data-lucide', newIconName);
  
  if (el.className) newEl.className = el.className;
  const style = el.getAttribute('style');
  if (style) newEl.setAttribute('style', style);
  
  el.parentNode.replaceChild(newEl, el);
}

// DOM Elements
const setupScreen = document.getElementById('setup-screen');
const nicknameInput = document.getElementById('nickname-input');
const joinPartyBtn = document.getElementById('join-party-btn');
const userBadge = document.getElementById('user-badge');
const badgeName = document.getElementById('badge-name');

// Navigation Tabs
const searchTabBtn = document.getElementById('search-tab-btn');
const queueTabBtn = document.getElementById('queue-tab-btn');
const partyTabBtn = document.getElementById('party-tab-btn');
const queueCountBadge = document.getElementById('queue-count');

// Sub-Tabs
const subTabRechercheBtn = document.getElementById('sub-tab-recherche-btn');
const subTabHistoriqueBtn = document.getElementById('sub-tab-historique-btn');
const subTabFavorisBtn = document.getElementById('sub-tab-favoris-btn');
const subTabSuggestionsBtn = document.getElementById('sub-tab-suggestions-btn');

// Panels
const searchPanel = document.getElementById('search-panel');
const queuePanel = document.getElementById('queue-panel');
const interactionsPanel = document.getElementById('interactions-panel');

const subPanelRecherche = document.getElementById('sub-panel-recherche');
const subPanelHistorique = document.getElementById('sub-panel-historique');
const subPanelFavoris = document.getElementById('sub-panel-favoris');
const subPanelSuggestions = document.getElementById('sub-panel-suggestions');

// Search inputs
const searchInput = document.getElementById('search-input');
const searchBackBtn = document.getElementById('search-back-btn');
const mobileWrapper = document.querySelector('.mobile-wrapper');
const resultsList = document.getElementById('results-list');
const historyList = document.getElementById('history-list');
const favoritesList = document.getElementById('favorites-list');
const suggestionsList = document.getElementById('suggestions-list');
const queueList = document.getElementById('queue-list');

// Mini Player DOM
const miniPlayerBar = document.getElementById('mini-player');
const miniPlayerInfoClick = document.getElementById('mini-player-info-click');
const miniPlayerThumb = document.getElementById('mini-player-thumb');
const miniPlayerTitle = document.getElementById('mini-player-title');
const miniPlayerUser = document.getElementById('mini-player-user');
const miniProgressFill = document.getElementById('mini-progress-fill');
const miniPlayPauseBtn = document.getElementById('mini-play-pause-btn');
const miniPlayPauseIcon = document.getElementById('mini-play-pause-icon');
const miniActionBtn = document.getElementById('mini-action-btn');
const miniActionIcon = document.getElementById('mini-action-icon');

// Full Player DOM
const fullPlayerOverlay = document.getElementById('full-player');
const fullPlayerBackdrop = document.getElementById('full-player-backdrop');
const fullPlayerCloseBtn = document.getElementById('full-player-close-btn');
const fullPlayerArtwork = document.getElementById('full-player-artwork');
const fullPlayerArtworkGlow = document.getElementById('full-player-artwork-glow');
const fullPlayerTitle = document.getElementById('full-player-title');
const fullPlayerUser = document.getElementById('full-player-user');
const fullPlayerFavoriteBtn = document.getElementById('full-player-favorite-btn');
const fullFavoriteIcon = document.getElementById('full-favorite-icon');

const fullProgressSlider = document.getElementById('full-progress-slider');
const fullProgressCurrent = document.getElementById('full-progress-current');
const fullProgressTotal = document.getElementById('full-progress-total');

const fullPrevBtn = document.getElementById('full-prev-btn');
const fullPlayPauseBtn = document.getElementById('full-play-pause-btn');
const fullPlayPauseIcon = document.getElementById('full-play-pause-icon');
const fullNextBtn = document.getElementById('full-next-btn');
const fullNextIcon = document.getElementById('full-next-icon');

const fullVetoSection = document.getElementById('full-veto-section');
const fullVetoBtn = document.getElementById('full-veto-btn');
const fullVetoCount = document.getElementById('full-veto-count');
const fullVetoRequired = document.getElementById('full-veto-required');

const fullVolumeSection = document.getElementById('full-volume-section');
const fullVolSlider = document.getElementById('full-vol-slider');
const fullVolText = document.getElementById('full-vol-text');

// Soirée Panel elements
const chatHistory = document.getElementById('chat-history');
const chatInput = document.getElementById('chat-input');
const chatSendBtn = document.getElementById('chat-send-btn');
const mobileMasterSettings = document.getElementById('mobile-master-settings');
const mobileFairplayCheckbox = document.getElementById('mobile-fairplay-checkbox');

// Skip overlay
const skipConfirmOverlay = document.getElementById('skip-confirm-overlay');
const skipCancelBtn = document.getElementById('skip-cancel-btn');
const skipYesBtn = document.getElementById('skip-yes-btn');

const mobileToast = document.getElementById('mobile-toast');
const richToast = document.getElementById('rich-toast');
const richToastImg = document.getElementById('rich-toast-img');
const richToastTitle = document.getElementById('rich-toast-title');

// ==========================================
// 1. NICKNAME MANAGEMENT
// ==========================================
const savedNickname = localStorage.getItem('party_nickname');
if (savedNickname) {
  nicknameInput.value = savedNickname;
}

joinPartyBtn.addEventListener('click', joinParty);
nicknameInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') joinParty();
});

function joinParty() {
  const nickname = nicknameInput.value.trim();
  if (!nickname) {
    showToast("Veuillez saisir un pseudo valide !", "error");
    return;
  }
  
  myNickname = nickname;
  localStorage.setItem('party_nickname', myNickname);
  
  setupScreen.style.opacity = '0';
  setTimeout(() => {
    setupScreen.style.display = 'none';
  }, 500);
  
  socket.emit('join', {
    type: 'mobile',
    nickname: myNickname,
    userId: myUserId
  });
  
  badgeName.textContent = myNickname;
}

socket.on('connection_established', (data) => {
  myId = data.socketId;
  if (myNickname) {
    socket.emit('join', {
      type: 'mobile',
      nickname: myNickname,
      userId: myUserId
    });
    showToast('Connexion rétablie !', 'success');
  }
});

socket.on('disconnect', (reason) => {
  showToast('Connexion perdue...', 'error');
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && socket && !socket.connected) {
    socket.connect();
  }
});

// Initialiser l'état de l'historique de navigation au chargement
if (window.history && window.history.replaceState) {
  window.history.replaceState({ tab: 'search', searching: false, playerOpen: false }, '');
}

// ==========================================
// 2. ROLE HANDLING
// ==========================================
socket.on('role_updated', (newRole) => {
  myRole = newRole;
  userBadge.className = `user-badge ${myRole.toLowerCase()}`;
  badgeName.textContent = `${myRole === 'Master' ? '👑 ' : ''}${myNickname}`;
  
  if (myRole === 'Master') {
    showToast("Vous êtes le Master !", "success");
    mobileMasterSettings.style.display = 'block';
  } else {
    mobileMasterSettings.style.display = 'none';
  }
  
  updateControlsForRole();
  renderQueueList();
  renderFavoritesList();
  renderHistoryList();
});

function updateControlsForRole() {
  const isMaster = myRole === 'Master';
  
  // Show / Hide appropriate sections
  if (isMaster) {
    fullPrevBtn.style.display = 'inline-flex';
    replaceIcon('full-next-icon', 'skip-forward');
    fullVolumeSection.style.display = 'flex';
    fullVetoSection.style.display = 'none';
    
    replaceIcon('mini-action-icon', 'skip-forward');
  } else {
    fullPrevBtn.style.display = 'none';
    replaceIcon('full-next-icon', 'shield-alert');
    fullVolumeSection.style.display = 'none';
    fullVetoSection.style.display = 'flex';
    
    replaceIcon('mini-action-icon', 'shield-alert');
  }
  refreshIcons();
}

// ==========================================
// 3. TAB NAVIGATION
// ==========================================
function switchPanel(panelId, tabBtn, fromHistory = false) {
  document.querySelectorAll('.panel-content').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  
  document.getElementById(panelId).classList.add('active');
  tabBtn.classList.add('active');
  closeMobileSearch(fromHistory);
  
  if (!fromHistory && window.history && window.history.pushState) {
    const tabName = panelId.replace('-panel', '');
    const searching = mobileWrapper.classList.contains('searching-mode');
    const playerOpen = fullPlayerOverlay.classList.contains('open');
    window.history.pushState({ tab: tabName, searching, playerOpen }, '');
  }
}

searchTabBtn.addEventListener('click', () => switchPanel('search-panel', searchTabBtn));
queueTabBtn.addEventListener('click', () => switchPanel('queue-panel', queueTabBtn));
partyTabBtn.addEventListener('click', () => switchPanel('interactions-panel', partyTabBtn));

// Sub tabs in Search panel
function switchSubPanel(subPanelId, subTabBtn) {
  document.querySelectorAll('.sub-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.sub-tab-btn').forEach(b => b.classList.remove('active'));
  
  document.getElementById(subPanelId).classList.add('active');
  subTabBtn.classList.add('active');
}

subTabRechercheBtn.addEventListener('click', () => switchSubPanel('sub-panel-recherche', subTabRechercheBtn));
subTabHistoriqueBtn.addEventListener('click', () => {
  closeMobileSearch(false);
  switchSubPanel('sub-panel-historique', subTabHistoriqueBtn);
  renderHistoryList();
});
subTabFavorisBtn.addEventListener('click', () => {
  closeMobileSearch(false);
  switchSubPanel('sub-panel-favoris', subTabFavorisBtn);
  renderFavoritesList();
});
subTabSuggestionsBtn.addEventListener('click', () => {
  closeMobileSearch(false);
  switchSubPanel('sub-panel-suggestions', subTabSuggestionsBtn);
  generateSuggestions();
});

// ==========================================
// 4. SEARCH & YOUTUBE RESOLUTION
// ==========================================
if (searchInput) {
  searchInput.addEventListener('focus', () => {
    if (!mobileWrapper.classList.contains('searching-mode')) {
      mobileWrapper.classList.add('searching-mode');
      searchBackBtn.style.display = 'flex';
      
      if (window.history && window.history.pushState) {
        const activeTab = document.querySelector('.tab-btn.active').id.replace('-tab-btn', '');
        const playerOpen = fullPlayerOverlay.classList.contains('open');
        window.history.pushState({ tab: activeTab, searching: true, playerOpen }, '');
      }
    }
  });

  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeMobileSearch(false);
  });

  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    const query = searchInput.value.trim();
    if (!query) {
      resultsList.innerHTML = `<li class="empty-list-placeholder">Recherchez un clip ou collez son lien ci-dessus pour l'ajouter à la playlist !</li>`;
      return;
    }
    searchTimeout = setTimeout(() => executeSearch(query), 600);
  });

  searchInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      clearTimeout(searchTimeout);
      const query = searchInput.value.trim();
      if (query) executeSearch(query);
    }
  });
}

searchBackBtn.addEventListener('click', () => closeMobileSearch(false));

function closeMobileSearch(fromHistory = false) {
  const wasSearching = mobileWrapper && mobileWrapper.classList.contains('searching-mode');
  if (mobileWrapper) mobileWrapper.classList.remove('searching-mode');
  if (searchBackBtn) searchBackBtn.style.display = 'none';
  if (searchInput) {
    searchInput.value = '';
    searchInput.blur();
  }
  resultsList.innerHTML = `<li class="empty-list-placeholder">Recherchez un clip ou collez son lien ci-dessus pour l'ajouter à la playlist !</li>`;
  
  if (wasSearching && !fromHistory && window.history && window.history.back) {
    window.history.back();
  }
}

async function executeSearch(query) {
  resultsList.innerHTML = `
    <li class="empty-list-placeholder">
      <div style="display:inline-block; width:20px; height:20px; border:3px solid var(--border-color); border-top-color:var(--primary); border-radius:50%; animation: spin 1s linear infinite; margin-right: 8px; vertical-align: middle;"></div>
      Recherche en cours...
    </li>
  `;
  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
    if (!res.ok) throw new Error('Échec de la recherche');
    const videos = await res.json();
    renderSearchResults(videos);
  } catch (err) {
    resultsList.innerHTML = `<li class="empty-list-placeholder" style="color:var(--danger);">❌ Une erreur est survenue lors de la recherche.</li>`;
  }
}

function renderSearchResults(videos) {
  resultsList.innerHTML = '';
  if (videos.length === 0) {
    resultsList.innerHTML = `<li class="empty-list-placeholder">Aucun résultat trouvé.</li>`;
    return;
  }
  
  videos.forEach(video => {
    const isFav = myFavorites.some(x => x.id === video.id);
    const li = document.createElement('li');
    li.className = 'search-item';
    li.innerHTML = `
      <div class="item-thumb-container">
        <img class="item-thumb" src="${video.thumbnail}" alt="miniature">
        <span class="item-duration">${video.duration}</span>
      </div>
      <div class="item-details">
        <h4 class="item-title">${escapeHTML(video.title)}</h4>
      </div>
      <div class="add-btn-group">
        <button class="favorite-btn ${isFav ? 'active' : ''}" title="Favori">
          <i data-lucide="heart" style="width: 14px; height: 14px;"></i>
        </button>
        <button class="add-first-btn" title="Ajouter en premier (Master)" style="display:${myRole === 'Master' ? 'flex' : 'none'}">
          <i data-lucide="arrow-up" style="width:14px;height:14px;"></i>
        </button>
        <button class="add-btn" title="Ajouter à la file">
          <i data-lucide="plus" style="width: 18px;"></i>
        </button>
      </div>
    `;
    
    // Heart toggle
    const favBtn = li.querySelector('.favorite-btn');
    favBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleFavorite(video);
      favBtn.classList.toggle('active');
    });

    const addFirstBtn = li.querySelector('.add-first-btn');
    if (addFirstBtn) {
      addFirstBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        socket.emit('add_to_queue_first', video);
        showRichToast(video, true);
        addToHistory(video);
      });
    }

    const addBtn = li.querySelector('.add-btn');
    li.addEventListener('click', () => {
      socket.emit('add_to_queue', video);
      showRichToast(video, false);
      addToHistory(video);
      if (addBtn) {
        addBtn.innerHTML = '<i data-lucide="check" style="width:18px;"></i>';
        addBtn.style.background = 'var(--emerald)';
        refreshIcons();
      }
    });

    resultsList.appendChild(li);
  });
  refreshIcons();
}

function toggleFavorite(video) {
  const idx = myFavorites.findIndex(x => x.id === video.id);
  if (idx >= 0) {
    myFavorites.splice(idx, 1);
    showToast("Retiré des favoris !", "success");
  } else {
    myFavorites.push(video);
    showToast("Ajouté aux favoris !", "success");
  }
  saveFavorites();
  renderFavoritesList();
  updateFavoriteButtonUI();
}

function addToHistory(video) {
  const existsIdx = myHistory.findIndex(x => x.id === video.id);
  if (existsIdx >= 0) {
    myHistory.splice(existsIdx, 1);
  }
  myHistory.unshift(video);
  if (myHistory.length > 50) myHistory.pop();
  saveHistory();
  renderHistoryList();
}

function renderFavoritesList() {
  if (!favoritesList) return;
  favoritesList.innerHTML = '';
  if (myFavorites.length === 0) {
    favoritesList.innerHTML = `<li class="empty-list-placeholder">Vous n'avez aucun titre favori.</li>`;
    return;
  }
  myFavorites.forEach(video => {
    const li = document.createElement('li');
    li.className = 'search-item';
    li.innerHTML = `
      <div class="item-thumb-container">
        <img class="item-thumb" src="${video.thumbnail}" alt="miniature">
        <span class="item-duration">${video.duration}</span>
      </div>
      <div class="item-details">
        <h4 class="item-title">${escapeHTML(video.title)}</h4>
      </div>
      <div class="add-btn-group">
        <button class="favorite-btn active" title="Favori">
          <i data-lucide="heart" style="width: 14px; height: 14px;"></i>
        </button>
        <button class="add-btn" title="Ajouter à la file">
          <i data-lucide="plus" style="width: 18px;"></i>
        </button>
      </div>
    `;
    li.querySelector('.favorite-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      toggleFavorite(video);
    });
    li.addEventListener('click', () => {
      socket.emit('add_to_queue', video);
      showRichToast(video, false);
      addToHistory(video);
    });
    favoritesList.appendChild(li);
  });
  refreshIcons();
}

function renderHistoryList() {
  if (!historyList) return;
  historyList.innerHTML = '';
  if (myHistory.length === 0) {
    historyList.innerHTML = `<li class="empty-list-placeholder">Aucun titre dans l'historique de cette session.</li>`;
    return;
  }
  myHistory.forEach(video => {
    const isFav = myFavorites.some(x => x.id === video.id);
    const li = document.createElement('li');
    li.className = 'search-item';
    li.innerHTML = `
      <div class="item-thumb-container">
        <img class="item-thumb" src="${video.thumbnail}" alt="miniature">
        <span class="item-duration">${video.duration}</span>
      </div>
      <div class="item-details">
        <h4 class="item-title">${escapeHTML(video.title)}</h4>
      </div>
      <div class="add-btn-group">
        <button class="favorite-btn ${isFav ? 'active' : ''}" title="Favori">
          <i data-lucide="heart" style="width: 14px; height: 14px;"></i>
        </button>
        <button class="add-btn" title="Ajouter à la file">
          <i data-lucide="plus" style="width: 18px;"></i>
        </button>
      </div>
    `;
    li.querySelector('.favorite-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      toggleFavorite(video);
    });
    li.addEventListener('click', () => {
      socket.emit('add_to_queue', video);
      showRichToast(video, false);
    });
    historyList.appendChild(li);
  });
  refreshIcons();
}

// Extract artist name from video title (e.g. "Loveni Ft. Myth Syzer - Verse La Gnôle" -> "Loveni")
function extractArtist(title) {
  if (!title) return null;
  const parts = title.split(/\s*[-–:|]\s*/);
  if (parts.length > 1) {
    let artist = parts[0].trim();
    artist = artist.split(/\s+(?:ft\.?|feat\.?|featuring|&|,)\s+/i)[0];
    return artist.trim();
  }
  return null;
}

// Get ranked list of most frequent artists in history and favorites
function getTopArtists() {
  const counts = {};
  [...myFavorites, ...myHistory].forEach(item => {
    const artist = extractArtist(item.title);
    if (artist) {
      counts[artist] = (counts[artist] || 0) + 1;
    }
  });
  return Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
}

// Generate personalized song suggestions based on top artists
async function generateSuggestions() {
  if (!suggestionsList) return;
  
  const artistList = getTopArtists();
  if (artistList.length === 0) {
    suggestionsList.innerHTML = `<li class="empty-list-placeholder">Ajoutez des favoris ou écoutez des musiques pour recevoir des suggestions personnalisées !</li>`;
    return;
  }
  
  suggestionsList.innerHTML = `
    <li class="empty-list-placeholder">
      <div style="display:inline-block; width:20px; height:20px; border:3px solid var(--border-color); border-top-color:var(--primary); border-radius:50%; animation: spin 1s linear infinite; margin-right: 8px; vertical-align: middle;"></div>
      Génération des suggestions...
    </li>
  `;
  
  try {
    const selectedArtists = artistList.slice(0, 3);
    const promises = selectedArtists.map(artist => 
      fetch(`/api/search?q=${encodeURIComponent(artist)}`)
        .then(res => res.ok ? res.json() : [])
        .catch(() => [])
    );
    
    const searchResults = await Promise.all(promises);
    let allVideos = [];
    searchResults.forEach(videos => {
      allVideos = allVideos.concat(videos);
    });
    
    const uniqueVideos = [];
    const seenIds = new Set();
    const excludedIds = new Set([
      ...myFavorites.map(x => x.id),
      ...myHistory.map(x => x.id),
      ...currentPlaylist.map(x => x.id),
      ...(currentVideoPlaying ? [currentVideoPlaying.id] : [])
    ]);
    
    allVideos.forEach(video => {
      if (!seenIds.has(video.id) && !excludedIds.has(video.id)) {
        seenIds.add(video.id);
        uniqueVideos.push(video);
      }
    });
    
    const suggestions = uniqueVideos.slice(0, 12);
    renderSuggestions(suggestions);
  } catch (err) {
    suggestionsList.innerHTML = `<li class="empty-list-placeholder" style="color:var(--danger);">❌ Impossible de générer des suggestions pour le moment.</li>`;
  }
}

// Render the suggestions list items
function renderSuggestions(videos) {
  suggestionsList.innerHTML = '';
  if (videos.length === 0) {
    suggestionsList.innerHTML = `<li class="empty-list-placeholder">Aucune suggestion trouvée pour le moment. Essayez d'écouter d'autres titres !</li>`;
    return;
  }
  
  videos.forEach(video => {
    const isFav = myFavorites.some(x => x.id === video.id);
    const li = document.createElement('li');
    li.className = 'search-item';
    li.innerHTML = `
      <div class="item-thumb-container">
        <img class="item-thumb" src="${video.thumbnail}" alt="miniature">
        <span class="item-duration">${video.duration}</span>
      </div>
      <div class="item-details">
        <h4 class="item-title">${escapeHTML(video.title)}</h4>
      </div>
      <div class="add-btn-group">
        <button class="favorite-btn ${isFav ? 'active' : ''}" title="Favori">
          <i data-lucide="heart" style="width: 14px; height: 14px;"></i>
        </button>
        <button class="add-btn" title="Ajouter à la file">
          <i data-lucide="plus" style="width: 18px;"></i>
        </button>
      </div>
    `;
    
    const favBtn = li.querySelector('.favorite-btn');
    favBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleFavorite(video);
      favBtn.classList.toggle('active');
    });
    
    const addBtn = li.querySelector('.add-btn');
    li.addEventListener('click', () => {
      socket.emit('add_to_queue', video);
      showRichToast(video, false);
      addToHistory(video);
      if (addBtn) {
        addBtn.innerHTML = '<i data-lucide="check" style="width:18px;"></i>';
        addBtn.style.background = 'var(--emerald)';
        refreshIcons();
      }
    });
    
    suggestionsList.appendChild(li);
  });
  
  refreshIcons();
}

// ==========================================
// 5. PLAYLIST SYNC AND RENDER
// ==========================================
socket.on('state_update', (data) => {
  currentPlaylist = data.queue;
  currentVideoPlaying = data.currentVideo;
  
  if (typeof data.isPlaying !== 'undefined') {
    isPlayingState = data.isPlaying;
  }
  
  renderNowPlaying();
  renderQueueList();
  updateVetoDisplay(data.vetoVotesCount, data.vetoVotesRequired);
  mobileFairplayCheckbox.checked = !!data.isFairPlayActive;
});

socket.on('queue_updated', (data) => {
  currentPlaylist = data.queue;
  currentVideoPlaying = data.currentVideo;
  
  if (typeof data.isPlaying !== 'undefined') {
    isPlayingState = data.isPlaying;
  }
  
  renderNowPlaying();
  renderQueueList();
});

socket.on('fairplay_updated', (data) => {
  mobileFairplayCheckbox.checked = !!data.isFairPlayActive;
});

function renderNowPlaying() {
  if (!currentVideoPlaying) {
    miniPlayerBar.style.display = 'none';
    fullPlayerOverlay.classList.remove('open');
    lastActiveVideoId = null;
    currentVideoDuration = 0;
    return;
  }
  
  if (lastActiveVideoId !== currentVideoPlaying.id) {
    lastActiveVideoId = currentVideoPlaying.id;
    currentVideoDuration = 0;
  }
  
  // Show Mini Player
  miniPlayerBar.style.display = 'block';
  miniPlayerThumb.src = currentVideoPlaying.thumbnail;
  miniPlayerTitle.textContent = currentVideoPlaying.title;
  const userSpan = miniPlayerBar.querySelector('#mini-player-user');
  if (userSpan) userSpan.textContent = currentVideoPlaying.addedBy;
  
  // Update Full Player Details
  fullPlayerArtwork.src = currentVideoPlaying.thumbnail;
  fullPlayerArtworkGlow.style.backgroundImage = `url(${currentVideoPlaying.thumbnail})`;
  fullPlayerTitle.textContent = currentVideoPlaying.title;
  const fullUserSpan = fullPlayerOverlay.querySelector('#full-player-user');
  if (fullUserSpan) fullUserSpan.textContent = currentVideoPlaying.addedBy;
  
  updatePlayPauseUI();
  updateFavoriteButtonUI();
}

function updatePlayPauseUI() {
  if (isPlayingState) {
    replaceIcon('mini-play-pause-icon', 'pause');
    replaceIcon('full-play-pause-icon', 'pause');
  } else {
    replaceIcon('mini-play-pause-icon', 'play');
    replaceIcon('full-play-pause-icon', 'play');
  }
  refreshIcons();
}

function updateFavoriteButtonUI() {
  if (!currentVideoPlaying) return;
  const isFav = myFavorites.some(x => x.id === currentVideoPlaying.id);
  if (isFav) {
    fullPlayerFavoriteBtn.classList.add('active');
    replaceIcon('full-favorite-icon', 'heart');
    fullFavoriteIcon.style.fill = 'var(--danger)';
  } else {
    fullPlayerFavoriteBtn.classList.remove('active');
    replaceIcon('full-favorite-icon', 'heart');
    fullFavoriteIcon.style.fill = 'none';
  }
  refreshIcons();
}

function renderQueueList() {
  queueList.innerHTML = '';
  queueCountBadge.textContent = currentPlaylist.length;
  
  if (currentPlaylist.length === 0) {
    queueList.innerHTML = `<li class="empty-queue">La file d'attente est vide pour l'instant.</li>`;
    return;
  }
  
  currentPlaylist.forEach((item, index) => {
    const li = document.createElement('li');
    li.className = 'queue-item';
    li.dataset.index = index;
    
    if (myRole === 'Master') {
      li.setAttribute('draggable', 'true');
    }
    
    const canDelete = (myRole === 'Master') || (item.addedById === myId);
    const deleteBtnHtml = canDelete ? `
      <button class="remove-btn" data-queue-id="${item.queueId}" title="Retirer">
        <i data-lucide="trash-2" style="width: 16px;"></i>
      </button>
    ` : '';
    
    const dragHandleHtml = (myRole === 'Master') ? `
      <div class="drag-handle" style="cursor: grab;">
        <i data-lucide="grip-vertical" style="width: 18px; height: 18px;"></i>
      </div>
    ` : '';
    
    li.innerHTML = `
      ${dragHandleHtml}
      <div class="queue-index">#${index + 1}</div>
      <div class="item-thumb-container" style="width: 70px; height: 46px; border-radius: 6px;">
        <img class="item-thumb" src="${item.thumbnail}" alt="miniature">
      </div>
      <div class="queue-item-details">
        <h4 class="queue-item-title">${escapeHTML(item.title)}</h4>
        <div class="queue-item-meta">Par <span>${escapeHTML(item.addedBy)}</span> (${item.duration})</div>
      </div>
      <div class="queue-item-actions">
        ${deleteBtnHtml}
      </div>
    `;
    
    // Bind Delete click
    if (canDelete) {
      const rmBtn = li.querySelector('.remove-btn');
      if (rmBtn) {
        rmBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          socket.emit('player_command', { action: 'remove', queueId: item.queueId });
        });
      }
    }
    
    // Drag and Drop listeners for Desktop
    if (myRole === 'Master') {
      li.addEventListener('dragstart', (e) => {
        dragStartIndex = index;
        li.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', index.toString());
      });
      
      li.addEventListener('dragover', (e) => {
        e.preventDefault();
        const rect = li.getBoundingClientRect();
        const y = e.clientY;
        const midY = rect.top + rect.height / 2;
        li.classList.remove('drag-insert-before', 'drag-insert-after');
        if (y < midY) {
          li.classList.add('drag-insert-before');
        } else {
          li.classList.add('drag-insert-after');
        }
      });
      
      li.addEventListener('dragleave', () => {
        li.classList.remove('drag-insert-before', 'drag-insert-after');
      });
      
      li.addEventListener('drop', (e) => {
        e.preventDefault();
        li.classList.remove('drag-insert-before', 'drag-insert-after');
        const fromIndex = parseInt(e.dataTransfer.getData('text/plain'), 10);
        const toIndex = index;
        if (fromIndex !== null && !isNaN(fromIndex) && fromIndex !== toIndex) {
          socket.emit('reorder_queue', { fromIndex, toIndex });
        }
      });
      
      li.addEventListener('dragend', () => {
        li.classList.remove('dragging');
        document.querySelectorAll('.queue-item').forEach(el => {
          el.classList.remove('drag-insert-before', 'drag-insert-after');
        });
        dragStartIndex = null;
      });
      
      // Touch Drag support
      let activeTouchElement = null;
      const handle = li.querySelector('.drag-handle');
      if (handle) {
        handle.addEventListener('touchstart', (e) => {
          dragStartIndex = index;
          activeTouchElement = li;
          li.classList.add('dragging');
          e.preventDefault();
        }, { passive: false });
        
        handle.addEventListener('touchmove', (e) => {
          if (dragStartIndex === null || activeTouchElement !== li) return;
          e.preventDefault();
          const touch = e.touches[0];
          
          // Hide dragged item to find what is underneath
          const pointerEvts = li.style.pointerEvents;
          const visibility = li.style.visibility;
          li.style.pointerEvents = 'none';
          li.style.visibility = 'hidden';
          
          const target = document.elementFromPoint(touch.clientX, touch.clientY);
          li.style.pointerEvents = pointerEvts;
          li.style.visibility = visibility;
          
          if (!target) return;
          const targetItem = target.closest('.queue-item');
          
          document.querySelectorAll('.queue-item').forEach(el => {
            if (el !== targetItem) el.classList.remove('drag-insert-before', 'drag-insert-after');
          });
          
          if (targetItem && targetItem !== li) {
            const rect = targetItem.getBoundingClientRect();
            const mid = rect.top + rect.height / 2;
            targetItem.classList.remove('drag-insert-before', 'drag-insert-after');
            if (touch.clientY < mid) {
              targetItem.classList.add('drag-insert-before');
            } else {
              targetItem.classList.add('drag-insert-after');
            }
          }
        }, { passive: false });
        
        handle.addEventListener('touchend', (e) => {
          if (dragStartIndex === null || activeTouchElement !== li) return;
          li.classList.remove('dragging');
          const touch = e.changedTouches[0];
          
          const pointerEvts = li.style.pointerEvents;
          const visibility = li.style.visibility;
          li.style.pointerEvents = 'none';
          li.style.visibility = 'hidden';
          
          const target = document.elementFromPoint(touch.clientX, touch.clientY);
          li.style.pointerEvents = pointerEvts;
          li.style.visibility = visibility;
          
          document.querySelectorAll('.queue-item').forEach(el => {
            el.classList.remove('drag-insert-before', 'drag-insert-after');
          });
          
          if (target) {
            const targetItem = target.closest('.queue-item');
            if (targetItem) {
              const toIndex = parseInt(targetItem.dataset.index, 10);
              if (dragStartIndex !== toIndex) {
                socket.emit('reorder_queue', { fromIndex: dragStartIndex, toIndex });
              }
            }
          }
          dragStartIndex = null;
          activeTouchElement = null;
        });
      }
    }
    
    queueList.appendChild(li);
  });
  
  refreshIcons();
}

// ==========================================
// 6. PLAYER CONTROLS (MINI AND FULL SCREEN)
// ==========================================
function togglePlayPause() {
  const action = isPlayingState ? 'pause' : 'play';
  socket.emit('player_command', { action });
  isPlayingState = !isPlayingState;
  updatePlayPauseUI();
}

miniPlayPauseBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  togglePlayPause();
});

fullPlayPauseBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  togglePlayPause();
});

// Veto or Skip Actions based on role
function triggerNextOrVeto() {
  if (myRole === 'Master') {
    showSkipConfirm();
  } else {
    socket.emit('vote_veto');
  }
}

miniActionBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  triggerNextOrVeto();
});

fullNextBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  triggerNextOrVeto();
});

fullVetoBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  socket.emit('vote_veto');
});

fullPrevBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  if (myRole !== 'Master') return;
  socket.emit('player_command', { action: 'previous' });
});

// Skip popup confirmation
function showSkipConfirm() {
  skipConfirmOverlay.classList.add('show');
}
function hideSkipConfirm() {
  skipConfirmOverlay.classList.remove('show');
}

skipCancelBtn.addEventListener('click', hideSkipConfirm);
skipYesBtn.addEventListener('click', () => {
  socket.emit('player_command', { action: 'skip' });
  hideSkipConfirm();
});
skipConfirmOverlay.addEventListener('click', (e) => {
  if (e.target === skipConfirmOverlay) hideSkipConfirm();
});

// Master settings volume sync
fullVolSlider.addEventListener('input', (e) => {
  if (myRole !== 'Master') return;
  const value = parseInt(e.target.value, 10);
  currentVolume = value;
  fullVolText.textContent = `${value}%`;
  socket.emit('player_command', { action: 'volume', value });
});

// Sockets updates sync command from other Master / TV
socket.on('tv_command', (data) => {
  if (data.action === 'play') {
    isPlayingState = true;
    updatePlayPauseUI();
  } else if (data.action === 'pause') {
    isPlayingState = false;
    updatePlayPauseUI();
  } else if (data.action === 'volume') {
    currentVolume = data.value;
    fullVolSlider.value = currentVolume;
    fullVolText.textContent = `${currentVolume}%`;
  }
});

// Slide up / Close overlay
miniPlayerInfoClick.addEventListener('click', () => {
  openFullPlayer();
});

fullPlayerCloseBtn.addEventListener('click', () => {
  closeFullPlayer(false);
});

fullPlayerBackdrop.addEventListener('click', () => {
  closeFullPlayer(false);
});

function openFullPlayer() {
  fullPlayerOverlay.classList.add('open');
  if (window.history && window.history.pushState) {
    const activeTab = document.querySelector('.tab-btn.active').id.replace('-tab-btn', '');
    const searching = mobileWrapper.classList.contains('searching-mode');
    window.history.pushState({ tab: activeTab, searching, playerOpen: true }, '');
  }
}

function closeFullPlayer(fromHistory = false) {
  const wasOpen = fullPlayerOverlay && fullPlayerOverlay.classList.contains('open');
  if (fullPlayerOverlay) fullPlayerOverlay.classList.remove('open');
  if (wasOpen && !fromHistory && window.history && window.history.back) {
    window.history.back();
  }
}

// Écouteur global pour le bouton retour physique
window.addEventListener('popstate', (e) => {
  const state = e.state || {};
  
  // 1. Fermer le lecteur s'il était ouvert et qu'on revient en arrière
  if (fullPlayerOverlay.classList.contains('open') && !state.playerOpen) {
    closeFullPlayer(true);
    return;
  }
  
  // 2. Fermer le mode recherche si actif et qu'on revient en arrière
  if (mobileWrapper.classList.contains('searching-mode') && !state.searching) {
    closeMobileSearch(true);
  }
  
  // 3. Restaurer l'onglet actif
  if (state.tab) {
    let tabBtnId = 'search-tab-btn';
    let panelId = 'search-panel';
    if (state.tab === 'queue') {
      tabBtnId = 'queue-tab-btn';
      panelId = 'queue-panel';
    } else if (state.tab === 'interactions') {
      tabBtnId = 'party-tab-btn';
      panelId = 'interactions-panel';
    }
    
    const tabBtn = document.getElementById(tabBtnId);
    if (tabBtn) {
      switchPanel(panelId, tabBtn, true);
    }
  }
});

// Heart toggle in Full Screen Player
fullPlayerFavoriteBtn.addEventListener('click', () => {
  if (currentVideoPlaying) {
    toggleFavorite(currentVideoPlaying);
  }
});

// Full slider seek logic
fullProgressSlider.addEventListener('change', (e) => {
  if (myRole !== 'Master') {
    showToast("Seul le Master peut changer la position !", "error");
    fullProgressSlider.value = lastKnownProgressPercent;
    return;
  }
  if (!currentVideoDuration || currentVideoDuration <= 0) return;
  const percentage = parseFloat(e.target.value) / 100;
  const targetSeconds = percentage * currentVideoDuration;
  
  lastKnownProgressTime = targetSeconds;
  lastKnownProgressPercent = percentage * 100;
  
  socket.emit('player_command', { action: 'seek', value: targetSeconds });
});

// ==========================================
// 7. TIME PROGRESS BAR & NOTIFICATIONS
// ==========================================
function formatTime(s) {
  if (!s || isNaN(s)) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60).toString().padStart(2, '0');
  return `${m}:${sec}`;
}

socket.on('progress_update', (data) => {
  currentVideoDuration = data.duration || 0;
  lastKnownProgressTime = data.currentTime || 0;
  lastKnownProgressPercent = data.percent || 0;
  
  // Update mini fill
  if (miniProgressFill) {
    miniProgressFill.style.width = `${data.percent}%`;
  }
  
  // Update full elements
  if (fullProgressSlider && document.activeElement !== fullProgressSlider) {
    fullProgressSlider.value = data.percent;
  }
  if (fullProgressCurrent) {
    fullProgressCurrent.textContent = formatTime(data.currentTime);
  }
  if (fullProgressTotal) {
    fullProgressTotal.textContent = formatTime(data.duration);
  }
});

function updateVetoDisplay(count, required) {
  if (fullVetoCount) fullVetoCount.textContent = count;
  if (fullVetoRequired) fullVetoRequired.textContent = required;
  
  // Update action btn tooltip/label in Guest Mode
  if (myRole !== 'Master') {
    const actionLabel = `Veto ${count}/${required}`;
    miniActionBtn.title = actionLabel;
  }
}

socket.on('error_message', (msg) => {
  showToast(msg, 'error');
});

// Toast helpers
let toastTimeout = null;
function showToast(message, type = 'error') {
  if (toastTimeout) clearTimeout(toastTimeout);
  mobileToast.textContent = message;
  mobileToast.className = `mobile-toast ${type} show`;
  toastTimeout = setTimeout(() => mobileToast.classList.remove('show'), 3000);
}

let richToastTimeout = null;
function showRichToast(video, isPriority = false) {
  if (richToastTimeout) clearTimeout(richToastTimeout);
  
  richToastImg.src = video.thumbnail;
  richToastTitle.textContent = video.title;
  
  const label = richToast.querySelector('.rich-toast-label');
  if (label) {
    label.textContent = isPriority ? '★ Ajouté EN PREMIER ⇑' : 'Ajouté à la playlist ✓';
  }
  
  richToast.classList.add('show');
  richToastTimeout = setTimeout(() => richToast.classList.remove('show'), 3000);
}

// ==========================================
// 8. INTERACTIVE SOIRÉE PANEL (CHAT, EMOJIS, SETTINGS)
// ==========================================

// Chat send trigger
function sendChatMessage() {
  const text = chatInput.value.trim();
  if (!text) return;
  
  socket.emit('send_chat_message', { text });
  chatInput.value = '';
}

chatSendBtn.addEventListener('click', sendChatMessage);
chatInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') sendChatMessage();
});

socket.on('new_chat_message', (msg) => {
  // Clear placeholder on first message
  const placeholder = chatHistory.querySelector('.chat-placeholder');
  if (placeholder) placeholder.remove();
  
  const msgDiv = document.createElement('div');
  msgDiv.className = `chat-msg ${msg.role.toLowerCase()}`;
  
  // Assign role color styling
  let roleBadge = '👤';
  if (msg.role === 'Master') roleBadge = '👑';
  else if (msg.role === 'Screen') roleBadge = '📺';
  
  msgDiv.innerHTML = `
    <span class="chat-sender">${roleBadge} ${escapeHTML(msg.nickname)}:</span>
    <span class="chat-text">${escapeHTML(msg.text)}</span>
  `;
  
  chatHistory.appendChild(msgDiv);
  
  // Scroll to bottom
  chatHistory.scrollTop = chatHistory.scrollHeight;
});

// Fair-Play master trigger
mobileFairplayCheckbox.addEventListener('change', (e) => {
  if (myRole !== 'Master') return;
  socket.emit('toggle_fairplay', { value: e.target.checked });
});

// Emoji reaction delegation for buttons (on both interactions panel and fullscreen overlay)
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.reaction-btn');
  if (btn) {
    const type = btn.getAttribute('data-type');
    socket.emit('emoji_reaction', { type });
    
    // Ripple shrink animation
    btn.style.transform = 'scale(0.85)';
    setTimeout(() => btn.style.transform = 'scale(1)', 150);
  }
});

// Helper escape
function escapeHTML(str) {
  return str.replace(/[&<>'"]/g, 
    tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
  );
}

// Init startup icons
refreshIcons();
