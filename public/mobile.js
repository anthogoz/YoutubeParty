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

// Récupération ou génération d'un Identifiant Utilisateur persistant (conserve le rôle Master)
let myUserId = localStorage.getItem('party_user_id');
if (!myUserId) {
  myUserId = 'uid_' + Math.random().toString(36).substring(2, 11);
  localStorage.setItem('party_user_id', myUserId);
}

// Helper pour rafraîchir les icônes Lucide
function refreshIcons() {
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

// Helper pour remplacer une icône de manière robuste avec Lucide (évite la perte de référence DOM après remplacement par SVG)
function replaceIcon(elementId, newIconName) {
  const el = document.getElementById(elementId);
  if (!el) return;
  
  const newEl = document.createElement('i');
  newEl.id = elementId;
  newEl.setAttribute('data-lucide', newIconName);
  
  // Conserver les classes et styles inline
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

const nowPlayingCard = document.getElementById('now-playing-card');

const searchTabBtn = document.getElementById('search-tab-btn');
const queueTabBtn = document.getElementById('queue-tab-btn');
const queueCountBadge = document.getElementById('queue-count');

const searchPanel = document.getElementById('search-panel');
const queuePanel = document.getElementById('queue-panel');

const searchInput = document.getElementById('search-input');
const searchBackBtn = document.getElementById('search-back-btn');
const mobileWrapper = document.querySelector('.mobile-wrapper');
const resultsList = document.getElementById('results-list');
const queueList = document.getElementById('queue-list');

// Master Controls DOM
const masterControls = document.getElementById('master-controls');
const playPauseBtn = document.getElementById('play-pause-btn');
const prevBtn = document.getElementById('prev-btn');
const skipBtn = document.getElementById('skip-btn');

// Nouveaux sélecteurs pour le Slider de Volume Master
const masterVolumeContainer = document.getElementById('master-volume-container');
const volSlider = document.getElementById('vol-slider');
const volValueText = document.getElementById('vol-value-text');

const mobileReactionsBar = document.getElementById('mobile-reactions-bar');
const mobileVetoBtn = document.getElementById('mobile-veto-btn');
const mobileVetoCount = document.getElementById('mobile-veto-count');
const mobileVetoRequired = document.getElementById('mobile-veto-required');
const mobileFairplayContainer = document.getElementById('mobile-fairplay-container');
const mobileFairplayCheckbox = document.getElementById('mobile-fairplay-checkbox');

const mobileToast = document.getElementById('mobile-toast');

// ==========================================
// 1. GESTION DU PSEUDO & REJOINDRE
// ==========================================

// Restaurer le pseudo précédent si disponible dans le localStorage
const savedNickname = localStorage.getItem('party_nickname');
if (savedNickname) {
  nicknameInput.value = savedNickname;
}

joinPartyBtn.addEventListener('click', joinParty);
nicknameInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    joinParty();
  }
});

function joinParty() {
  const nickname = nicknameInput.value.trim();
  
  if (!nickname) {
    showToast("Veuillez saisir un pseudo valide !", "error");
    return;
  }
  
  myNickname = nickname;
  localStorage.setItem('party_nickname', myNickname);
  
  // Transition d'extinction de l'écran d'accueil
  setupScreen.style.opacity = '0';
  setTimeout(() => {
    setupScreen.style.display = 'none';
  }, 500);
  
  // Envoyer la demande au serveur avec le pseudonyme et l'ID utilisateur persistant
  socket.emit('join', {
    type: 'mobile',
    nickname: myNickname,
    userId: myUserId
  });
  
  // Mettre à jour l'affichage initial du badge
  badgeName.textContent = myNickname;
}

// Enregistrement de l'ID Socket attribué
socket.on('connection_established', (data) => {
  myId = data.socketId;
  console.log('ID Socket enregistré :', myId);
  
  // Re-join automatique si déjà connecté précédemment (ex: après une déconnexion/mise en veille)
  if (myNickname) {
    console.log('Re-connexion détectée, envoi de join pour le pseudo :', myNickname);
    socket.emit('join', {
      type: 'mobile',
      nickname: myNickname,
      userId: myUserId
    });
    showToast('Connexion rétablie !', 'success');
  }
});

// Gérer la déconnexion
socket.on('disconnect', (reason) => {
  console.warn('Socket déconnecté du serveur :', reason);
  showToast('Connexion temporairement perdue...', 'error');
});

// Détecter le retour de veille du mobile pour forcer la reconnexion du socket si nécessaire
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    console.log('Mobile sorti de veille (page visible), vérification de la socket...');
    if (socket && !socket.connected) {
      console.log('Socket hors ligne, reconnexion en cours...');
      socket.connect();
    }
  }
});

// ==========================================
// 2. GESTION DES RÔLES
// ==========================================
socket.on('role_updated', (newRole) => {
  myRole = newRole;
  console.log(`Votre rôle a changé : [${myRole}]`);
  
  // Mettre à jour le style du badge
  userBadge.className = `user-badge ${myRole.toLowerCase()}`;
  badgeName.textContent = `${myRole === 'Master' ? '👑 ' : ''}${myNickname}`;
  
  if (myRole === 'Master') {
    showToast("Vous avez été promu Master de la soirée !", "success");
  }
  
  // Mettre à jour l'affichage des contrôles
  if (currentVideoPlaying) {
    masterControls.classList.add('visible');
    updateControlsForRole();
  } else {
    masterControls.classList.remove('visible');
  }
  
  // Rafraîchir la liste de lecture (pour afficher/masquer les boutons de suppression)
  renderQueueList();
});

// ==========================================
// 3. SYSTÈME D'ONGLETS MOBILE & COMPORTEMENT DU BOUTON RETOUR PHYSIQUE
// ==========================================

// Initialiser l'état de l'historique au chargement
if (window.history && window.history.replaceState) {
  window.history.replaceState({ tab: 'search', searching: false }, '');
}

// Écouteur global des popstate (bouton retour physique d'Android ou glissement retour d'iOS)
window.addEventListener('popstate', (e) => {
  const state = e.state;
  if (!state) return;
  
  if (mobileWrapper && mobileWrapper.classList.contains('searching-mode')) {
    if (!state.searching) {
      closeMobileSearch(true);
    }
  } else {
    if (state.tab === 'search') {
      activateSearchTab(true);
    } else if (state.tab === 'queue') {
      activateQueueTab(true);
    }
  }
});

function activateSearchTab(fromHistory = false) {
  searchTabBtn.classList.add('active');
  queueTabBtn.classList.remove('active');
  
  searchPanel.classList.add('active');
  queuePanel.classList.remove('active');
  
  if (!fromHistory && window.history && window.history.pushState) {
    window.history.pushState({ tab: 'search', searching: false }, '');
  }
}

function activateQueueTab(fromHistory = false) {
  queueTabBtn.classList.add('active');
  searchTabBtn.classList.remove('active');
  
  queuePanel.classList.add('active');
  searchPanel.classList.remove('active');
  
  if (!fromHistory && window.history && window.history.pushState) {
    window.history.pushState({ tab: 'queue', searching: false }, '');
  }
}

searchTabBtn.addEventListener('click', () => activateSearchTab(false));
queueTabBtn.addEventListener('click', () => activateQueueTab(false));

// ==========================================
// 4. RECHERCHE DE VIDÉOS YOUTUBE (Scraping ou API)
// ==========================================

// Activer le mode recherche plein écran (masquer le superflu)
if (searchInput) {
  searchInput.addEventListener('focus', () => {
    if (mobileWrapper) mobileWrapper.classList.add('searching-mode');
    if (searchBackBtn) searchBackBtn.style.display = 'flex';
    
    if (window.history && window.history.pushState) {
      window.history.pushState({ tab: 'search', searching: true }, '');
    }
  });

  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeMobileSearch(false);
    }
  });
}

// Bouton de retour en arrière pour fermer le plein écran de recherche
if (searchBackBtn) {
  searchBackBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    closeMobileSearch(false);
  });
}

function closeMobileSearch(fromHistory = false) {
  if (mobileWrapper) mobileWrapper.classList.remove('searching-mode');
  if (searchBackBtn) searchBackBtn.style.display = 'none';
  if (searchInput) {
    searchInput.value = '';
    searchInput.blur();
  }
  resultsList.innerHTML = `
    <li style="color: var(--text-muted); font-size: 0.95rem; text-align: center; padding: 2rem;">
      Recherchez une vidéo ci-dessus pour l'ajouter à la soirée !
    </li>
  `;
  
  if (!fromHistory && window.history && window.history.back) {
    window.history.back();
  }
}
searchInput.addEventListener('input', () => {
  clearTimeout(searchTimeout);
  const query = searchInput.value.trim();
  
  if (!query) {
    resultsList.innerHTML = `
      <li style="color: var(--text-muted); font-size: 0.95rem; text-align: center; padding: 2rem;">
        Recherchez une vidéo ci-dessus pour l'ajouter à la soirée !
      </li>
    `;
    return;
  }

  // Lancer une recherche automatiquement après 600ms sans saisie (debounce)
  searchTimeout = setTimeout(() => {
    executeSearch(query);
  }, 600);
});

searchInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    clearTimeout(searchTimeout);
    const query = searchInput.value.trim();
    if (query) {
      executeSearch(query);
    }
  }
});

async function executeSearch(query) {
  resultsList.innerHTML = `
    <li style="text-align: center; padding: 2rem; color: var(--text-secondary);">
      <div style="display:inline-block; width:20px; height:20px; border:3px solid var(--border-color); border-top-color:var(--primary); border-radius:50%; animation: spin 1s linear infinite; margin-right: 8px; vertical-align: middle;"></div>
      Recherche en cours...
    </li>
  `;
  
  // Style d'animation CSS injecté temporairement
  if (!document.getElementById('spin-keyframes')) {
    const style = document.createElement('style');
    style.id = 'spin-keyframes';
    style.innerHTML = `@keyframes spin { to { transform: rotate(360deg); } }`;
    document.head.appendChild(style);
  }

  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || `Erreur serveur (Code : ${res.status})`);
    }
    
    const videos = await res.json();
    renderSearchResults(videos);
  } catch (err) {
    console.error('Erreur recherche vidéos :', err);
    resultsList.innerHTML = `
      <li style="color: var(--danger); text-align: center; padding: 2rem; font-weight: 500;">
        ❌ ${escapeHTML(err.message)}
      </li>
    `;
  }
}

function renderSearchResults(videos) {
  resultsList.innerHTML = '';
  
  if (videos.length === 0) {
    resultsList.innerHTML = `
      <li style="color: var(--text-muted); text-align: center; padding: 2rem;">
        Aucun résultat trouvé pour votre recherche.
      </li>
    `;
    return;
  }
  
  videos.forEach(video => {
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
        <button class="add-first-btn" title="Ajouter en tête de playlist (Master)" style="display:${myRole === 'Master' ? 'flex' : 'none'}">
          <i data-lucide="arrow-up" style="width:14px;height:14px;"></i>
        </button>
        <button class="add-btn" title="Ajouter à la file">
          <i data-lucide="plus" style="width: 18px;"></i>
        </button>
      </div>
    `;
    
    const addFirstBtn = li.querySelector('.add-first-btn');
    const addBtn = li.querySelector('.add-btn');
    
    // Ajouter en tête (Master)
    if (addFirstBtn) {
      addFirstBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        socket.emit('add_to_queue_first', video);
        showRichToast(video, true);
        addFirstBtn.innerHTML = '<i data-lucide="check" style="width:14px;height:14px;"></i>';
        addFirstBtn.style.background = 'var(--primary)';
        addFirstBtn.style.color = '#fff';
        refreshIcons();
      });
    }
    
    // Événement d'ajout au clic sur TOUTE la carte de la vidéo
    li.style.cursor = 'pointer';
    li.addEventListener('click', (e) => {
      if (e.target.closest('.add-first-btn')) return; // Déjà géré
      socket.emit('add_to_queue', video);
      showRichToast(video);
      
      // Petit effet haptique / visuel temporaire sur le bouton '+'
      if (addBtn) {
        addBtn.innerHTML = '<i data-lucide="check" style="width: 18px;"></i>';
        addBtn.style.background = 'var(--emerald)';
        addBtn.style.color = '#fff';
        refreshIcons();
      }
    });
    
    resultsList.appendChild(li);
  });
  
  refreshIcons();
}

// ==========================================
// 5. SYNCHRONISATION DE LA FILE D'ATTENTE & LECTEUR
// ==========================================

// Événement d'état global
socket.on('state_update', (data) => {
  currentPlaylist = data.queue;
  currentVideoPlaying = data.currentVideo;
  
  renderNowPlayingCard();
  renderQueueList();
  
  if (typeof updateMobileVetoCount === 'function') {
    updateMobileVetoCount(data.vetoVotesCount, data.vetoVotesRequired);
  }
  if (typeof updateMobileFairPlayCheckbox === 'function') {
    updateMobileFairPlayCheckbox(data.isFairPlayActive);
  }
  // Synchroniser l'état play/pause depuis le serveur
  if (typeof data.isPlaying !== 'undefined') {
    isPlayingState = data.isPlaying;
    updatePlayPauseButton();
  }
});

// Événement de mise à jour de la playlist
socket.on('queue_updated', (data) => {
  currentPlaylist = data.queue;
  currentVideoPlaying = data.currentVideo;
  
  renderNowPlayingCard();
  renderQueueList();
  
  if (typeof updateMobileVetoCount === 'function') {
    updateMobileVetoCount(data.vetoVotesCount, data.vetoVotesRequired);
  }
  if (typeof updateMobileFairPlayCheckbox === 'function') {
    updateMobileFairPlayCheckbox(data.isFairPlayActive);
  }
  // Synchroniser l'état play/pause depuis le serveur
  if (typeof data.isPlaying !== 'undefined') {
    isPlayingState = data.isPlaying;
    updatePlayPauseButton();
  }
});

function renderNowPlayingCard() {
  if (!currentVideoPlaying) {
    nowPlayingCard.innerHTML = `<div class="no-video-active">Aucun clip en cours de lecture</div>`;
    nowPlayingCard.style.border = '';
    nowPlayingCard.style.boxShadow = '';
    isPlayingState = false;
    lastActiveVideoId = null;
    lastKnownProgressTime = 0;
    lastKnownProgressPercent = 0;
    currentVideoDuration = 0;
    updatePlayPauseButton();
    masterControls.classList.remove('visible');
    if (mobileReactionsBar) mobileReactionsBar.style.display = 'none';
    if (mobileVetoBtn) mobileVetoBtn.style.display = 'none';
    return;
  }
  
  // Réinitialiser la progression si c'est un nouveau clip
  if (lastActiveVideoId !== currentVideoPlaying.id) {
    lastActiveVideoId = currentVideoPlaying.id;
    lastKnownProgressTime = 0;
    lastKnownProgressPercent = 0;
    currentVideoDuration = 0;
  }
  
  // Ne pas toucher à isPlayingState ici : il est géré par state_update / queue_updated / tv_command
  updatePlayPauseButton();
  if (mobileReactionsBar) mobileReactionsBar.style.display = 'flex';
  if (mobileVetoBtn) mobileVetoBtn.style.display = 'flex';
  
  // Appliquer le style de bordure en pointillés sur le conteneur principal existant
  nowPlayingCard.style.border = '1px dashed var(--primary)';
  nowPlayingCard.style.boxShadow = '0 0 15px rgba(99, 102, 241, 0.15)';
  
  nowPlayingCard.innerHTML = `
    <div class="np-thumb-container">
      <img class="np-thumb" src="${currentVideoPlaying.thumbnail}" alt="miniature">
      <div class="np-glow"></div>
    </div>
    <div class="np-info">
      <div class="np-label">
        <div class="equalizer-bars" id="mobile-equalizer">
          <div class="eq-bar"></div>
          <div class="eq-bar"></div>
          <div class="eq-bar"></div>
          <div class="eq-bar"></div>
        </div>
        <span style="margin-left:0.3rem;">Lecture en cours</span>
      </div>
      <h4 class="np-title">${escapeHTML(currentVideoPlaying.title)}</h4>
      <div class="np-user">Ajouté par <span>${escapeHTML(currentVideoPlaying.addedBy)}</span></div>
      <div id="mobile-progress-track" style="width:100%; height:16px; display:flex; align-items:center; cursor:${myRole === 'Master' ? 'pointer' : 'default'}; margin-top:0.35rem;">
        <div class="np-progress-bar" style="margin:0; flex:1;">
          <div class="np-progress-fill" id="mobile-progress-fill" style="width: ${lastKnownProgressPercent}%;"></div>
        </div>
      </div>
      <div class="np-progress-times">
        <span id="mobile-progress-current">${formatTime(lastKnownProgressTime)}</span>
        <span id="mobile-progress-total">${formatTime(currentVideoDuration)}</span>
      </div>
    </div>
  `;

  // Sync égaliseur avec l'état play/pause actuel
  syncEqualizerState();

  // Afficher la barre de contrôles pour tout le monde (Master + Guest)
  masterControls.classList.add('visible');
  updateControlsForRole();
}

function updateControlsForRole() {
  const isMaster = myRole === 'Master';
  
  const panelTitle = document.querySelector('.master-panel-title');
  
  if (isMaster) {
    if (prevBtn) prevBtn.style.display = 'flex';
    if (skipBtn) skipBtn.style.display = 'flex';
    if (masterVolumeContainer) masterVolumeContainer.style.display = 'flex';
    if (mobileFairplayContainer) mobileFairplayContainer.style.display = 'flex';
    if (panelTitle) {
      panelTitle.innerHTML = '<i data-lucide="crown" style="width: 14px; vertical-align: middle;"></i> CONTRÔLES MASTER';
      panelTitle.style.color = 'var(--emerald)';
    }
  } else {
    if (prevBtn) prevBtn.style.display = 'none';
    if (skipBtn) skipBtn.style.display = 'none';
    if (masterVolumeContainer) masterVolumeContainer.style.display = 'none';
    if (mobileFairplayContainer) mobileFairplayContainer.style.display = 'none';
    if (panelTitle) {
      panelTitle.innerHTML = '<i data-lucide="music" style="width: 14px; vertical-align: middle;"></i> CONTRÔLE DE LECTURE';
      panelTitle.style.color = 'var(--primary)';
    }
  }
  // Afficher/masquer le bouton ajouter en premier dans les résultats de recherche
  document.querySelectorAll('.add-first-btn').forEach(btn => {
    btn.style.display = isMaster ? 'flex' : 'none';
  });
  refreshIcons();
}

function renderQueueList() {
  queueList.innerHTML = '';
  
  // Mettre à jour le badge du nombre de vidéos
  queueCountBadge.textContent = currentPlaylist.length;
  
  if (currentPlaylist.length === 0) {
    queueList.innerHTML = `<li class="empty-queue">La file d'attente est vide pour l'instant.</li>`;
    return;
  }
  
  currentPlaylist.forEach((item, index) => {
    const li = document.createElement('li');
    li.className = 'queue-item';
    li.dataset.index = index;
    
    // Activer l'attribut draggable de l'élément uniquement si Master
    if (myRole === 'Master') {
      li.setAttribute('draggable', 'true');
    }
    
    // Déterminer si l'utilisateur connecté a le droit de supprimer l'élément
    const canDelete = (myRole === 'Master') || (item.addedById === myId);
    const deleteBtnHtml = canDelete ? `
      <button class="remove-btn" data-queue-id="${item.queueId}" title="Retirer de la file">
        <i data-lucide="trash-2" style="width: 16px;"></i>
      </button>
    ` : '';
    
    // Ajouter une poignée visuelle de déplacement agrandie pour les Masters (zone tactile large)
    const dragHandleHtml = (myRole === 'Master') ? `
      <div class="drag-handle" style="cursor: grab; display: flex; align-items: center; justify-content: center; color: var(--text-muted); width: 44px; height: 100%; margin-left: -8px; padding-right: 6px;">
        <i data-lucide="grip-vertical" style="width: 20px; height: 20px;"></i>
      </div>
    ` : '';
    
    li.innerHTML = `
      ${dragHandleHtml}
      <div style="font-size:0.9rem; font-weight:800; color:var(--primary); width:20px; flex-shrink:0; text-align:center;">
        #${index + 1}
      </div>
      <div class="item-thumb-container" style="width: 60px; height: 40px; border-radius: 4px;">
        <img class="item-thumb" src="${item.thumbnail}" alt="miniature">
      </div>
      <div class="queue-item-details">
        <h4 class="queue-item-title">${escapeHTML(item.title)}</h4>
        <div class="queue-item-meta">Ajouté par <span>${escapeHTML(item.addedBy)}</span> (${item.duration})</div>
      </div>
      ${deleteBtnHtml}
    `;
    
    // Wrapper pour le swipe-to-delete
    const wrapper = document.createElement('div');
    wrapper.className = 'queue-item-swipe-wrapper';
    const deleteBg = document.createElement('div');
    deleteBg.className = 'queue-item-delete-bg';
    deleteBg.innerHTML = '🗑️';
    wrapper.appendChild(deleteBg);
    wrapper.appendChild(li);
    
    // Attacher l'événement au bouton supprimer
    if (canDelete) {
      const removeBtn = li.querySelector('.remove-btn');
      if (removeBtn) {
        removeBtn.addEventListener('click', () => {
          socket.emit('player_command', { action: 'remove', queueId: item.queueId });
        });
      }
      
      // --- SWIPE-TO-DELETE (TOUCH) ---
      let swipeStartX = null;
      let isSwiping = false;
      
      li.addEventListener('touchstart', (e) => {
        // Ne pas déclencher si c'est la poignée de drag
        if (e.target.closest('.drag-handle')) return;
        swipeStartX = e.touches[0].clientX;
        isSwiping = false;
      }, { passive: true });
      
      li.addEventListener('touchmove', (e) => {
        if (swipeStartX === null) return;
        const dx = e.touches[0].clientX - swipeStartX;
        if (dx < -15) {
          isSwiping = true;
          li.classList.add('swiping');
          wrapper.classList.add('swiping');
          e.preventDefault();
        } else if (dx > 10) {
          // Annuler si swipe vers droite
          li.classList.remove('swiping');
          wrapper.classList.remove('swiping');
          isSwiping = false;
          swipeStartX = null;
        }
      }, { passive: false });
      
      li.addEventListener('touchend', () => {
        if (isSwiping) {
          // Supprimer après un court délai visuel
          setTimeout(() => {
            socket.emit('player_command', { action: 'remove', queueId: item.queueId });
          }, 200);
        } else {
          li.classList.remove('swiping');
          wrapper.classList.remove('swiping');
        }
        swipeStartX = null;
        isSwiping = false;
      });
    }
    
    // Événements de Glisser-Déposer si Master
    if (myRole === 'Master') {
      // --- GLISSER-DÉPOSER CLASSIQUE (MOUSE / DESKTOP PC) ---
      li.addEventListener('dragstart', (e) => {
        dragStartIndex = index;
        li.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', index.toString()); // Toujours passer une String pour éviter les plantages
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
      
      // --- GLISSER-DÉPOSER TACTILE (TOUCH / MOBILE) ---
      let activeTouchElement = null;
      
      li.addEventListener('touchstart', (e) => {
        // Déclencher uniquement sur clic de la poignée de déplacement
        if (!e.target.closest('.drag-handle')) return;
        dragStartIndex = index;
        activeTouchElement = li;
        li.classList.add('dragging');
        
        // Empêcher le défilement de la page pendant qu'on drag
        e.preventDefault();
      }, { passive: false });
      
      li.addEventListener('touchmove', (e) => {
        if (dragStartIndex === null || activeTouchElement !== li) return;
        e.preventDefault();
        
        const touch = e.touches[0];
        
        // ASTUCE CRUCIALE : Cacher temporairement l'élément traîné pour que elementFromPoint détecte ce qu'il y a en dessous !
        const originalPointerEvents = li.style.pointerEvents;
        const originalVisibility = li.style.visibility;
        li.style.pointerEvents = 'none';
        li.style.visibility = 'hidden';
        
        const elementUnderTouch = document.elementFromPoint(touch.clientX, touch.clientY);
        
        // Restaurer l'affichage de l'élément
        li.style.pointerEvents = originalPointerEvents;
        li.style.visibility = originalVisibility;
        
        if (!elementUnderTouch) return;
        const targetItem = elementUnderTouch.closest('.queue-item');
        
        // Nettoyer la classe de survol sur les autres éléments de la playlist
        document.querySelectorAll('.queue-item').forEach(el => {
          if (el !== targetItem) {
            el.classList.remove('drag-insert-before', 'drag-insert-after');
          }
        });
        
        if (targetItem && targetItem !== li) {
          const rect = targetItem.getBoundingClientRect();
          const y = touch.clientY;
          const midY = rect.top + rect.height / 2;
          
          targetItem.classList.remove('drag-insert-before', 'drag-insert-after');
          if (y < midY) {
            targetItem.classList.add('drag-insert-before');
          } else {
            targetItem.classList.add('drag-insert-after');
          }
        }
      }, { passive: false });
      
      li.addEventListener('touchend', (e) => {
        if (dragStartIndex === null || activeTouchElement !== li) return;
        li.classList.remove('dragging');
        
        const touch = e.changedTouches[0];
        
        // ASTUCE CRUCIALE : Cacher temporairement l'élément traîné pour détecter l'élément cible final
        const originalPointerEvents = li.style.pointerEvents;
        const originalVisibility = li.style.visibility;
        li.style.pointerEvents = 'none';
        li.style.visibility = 'hidden';
        
        const elementUnderTouch = document.elementFromPoint(touch.clientX, touch.clientY);
        
        // Restaurer
        li.style.pointerEvents = originalPointerEvents;
        li.style.visibility = originalVisibility;
        
        document.querySelectorAll('.queue-item').forEach(el => {
          el.classList.remove('drag-insert-before', 'drag-insert-after');
        });
        
        if (elementUnderTouch) {
          const targetItem = elementUnderTouch.closest('.queue-item');
          if (targetItem) {
            const toIndex = parseInt(targetItem.dataset.index, 10);
            if (dragStartIndex !== toIndex) {
              socket.emit('reorder_queue', { fromIndex: dragStartIndex, toIndex: toIndex });
            }
          }
        }
        
        dragStartIndex = null;
        activeTouchElement = null;
      });
    }
    
    queueList.appendChild(wrapper);
  });
  
  refreshIcons();
}

// ==========================================
// 6. GESTION DES BOUTONS DE CONTRÔLES MASTER
// ==========================================

socket.on('tv_command', (data) => {
  // Synchroniser l'état Play/Pause reçu d'autres Masters
  if (data.action === 'play') {
    isPlayingState = true;
    updatePlayPauseButton();
  } else if (data.action === 'pause') {
    isPlayingState = false;
    updatePlayPauseButton();
  } else if (data.action === 'volume') {
    // Synchroniser le volume reçu d'autres Master ou de l'Écran
    currentVolume = data.value;
    if (volSlider) volSlider.value = currentVolume;
    if (volValueText) volValueText.textContent = `${currentVolume}%`;
    updateVolIcon(currentVolume);
  }
});

function updatePlayPauseButton() {
  if (isPlayingState) {
    replaceIcon('play-pause-icon', 'pause');
    playPauseBtn.title = "Mettre en pause";
  } else {
    replaceIcon('play-pause-icon', 'play');
    playPauseBtn.title = "Lancer la lecture";
  }
  syncEqualizerState();
  refreshIcons();
}

// Bouton Play/Pause
playPauseBtn.addEventListener('click', () => {
  if (myRole !== 'Master') return;
  
  const action = isPlayingState ? 'pause' : 'play';
  socket.emit('player_command', { action: action });
  
  isPlayingState = !isPlayingState;
  updatePlayPauseButton();
});

// Bouton Précédent (Previous)
if (prevBtn) {
  prevBtn.addEventListener('click', () => {
    if (myRole !== 'Master') return;
    socket.emit('player_command', { action: 'previous' });
  });
}

// Bouton Passer (Skip) — avec confirmation
skipBtn.addEventListener('click', () => {
  if (myRole !== 'Master') return;
  showSkipConfirm();
});

// --- POPUP CONFIRMATION SKIP ---
const skipConfirmOverlay = document.getElementById('skip-confirm-overlay');
const skipCancelBtn = document.getElementById('skip-cancel-btn');
const skipYesBtn = document.getElementById('skip-yes-btn');

function showSkipConfirm() {
  if (skipConfirmOverlay) skipConfirmOverlay.classList.add('show');
}
function hideSkipConfirm() {
  if (skipConfirmOverlay) skipConfirmOverlay.classList.remove('show');
}

if (skipCancelBtn) skipCancelBtn.addEventListener('click', hideSkipConfirm);
if (skipYesBtn) {
  skipYesBtn.addEventListener('click', () => {
    socket.emit('player_command', { action: 'skip' });
    hideSkipConfirm();
  });
}
// Fermer si clic sur le fond
if (skipConfirmOverlay) {
  skipConfirmOverlay.addEventListener('click', (e) => {
    if (e.target === skipConfirmOverlay) hideSkipConfirm();
  });
}

// Gestion du Slider de Volume Master
if (volSlider) {
  volSlider.addEventListener('input', (e) => {
    if (myRole !== 'Master') return;
    const value = parseInt(e.target.value);
    currentVolume = value;
    if (volValueText) volValueText.textContent = `${currentVolume}%`;
    
    updateVolIcon(currentVolume);
    
    // Envoyer la commande de changement de volume au serveur
    socket.emit('player_command', { action: 'volume', value: currentVolume });
  });
}

// Met à jour dynamiquement l'icône de volume selon la valeur
function updateVolIcon(vol) {
  if (vol === 0) {
    replaceIcon('vol-icon-indicator', 'volume-x');
  } else if (vol < 40) {
    replaceIcon('vol-icon-indicator', 'volume-1');
  } else {
    replaceIcon('vol-icon-indicator', 'volume-2');
  }
  refreshIcons();
}

// Écouter les éventuels messages d'erreur du serveur (Ex: action non autorisée)
socket.on('error_message', (msg) => {
  showToast(msg, 'error');
});

// ==========================================
// 7. TOAST DE NOTIFICATION SUR MOBILE
// ==========================================
let toastMobileTimeout = null;

function showToast(message, type = 'error') {
  if (toastMobileTimeout) clearTimeout(toastMobileTimeout);
  mobileToast.textContent = message;
  mobileToast.className = `mobile-toast ${type} show`;
  toastMobileTimeout = setTimeout(() => { mobileToast.classList.remove('show'); }, 3000);
}

// --- TOAST RICHE (avec miniature vidéo) ---
const richToast = document.getElementById('rich-toast');
const richToastImg = document.getElementById('rich-toast-img');
const richToastTitle = document.getElementById('rich-toast-title');
let richToastTimeout = null;

function showRichToast(video, isPriority = false) {
  if (!richToast || !richToastImg || !richToastTitle) return;
  if (richToastTimeout) clearTimeout(richToastTimeout);
  
  richToastImg.src = video.thumbnail;
  richToastTitle.textContent = video.title;
  
  // Changer le label selon si c'est une priorité
  const label = richToast.querySelector('.rich-toast-label');
  if (label) label.textContent = isPriority ? '★ Ajouté EN PREMIER ⇑' : 'Ajouté à la playlist ✓';
  
  richToast.classList.add('show');
  richToastTimeout = setTimeout(() => { richToast.classList.remove('show'); }, 3000);
}

// --- PROGRESS BAR MOBILE ---
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
  
  const fill = document.getElementById('mobile-progress-fill');
  const curr = document.getElementById('mobile-progress-current');
  const tot = document.getElementById('mobile-progress-total');
  if (fill) fill.style.width = `${data.percent}%`;
  if (curr) curr.textContent = formatTime(data.currentTime);
  if (tot) tot.textContent = formatTime(data.duration);
});

// Écouteur pour faire un seek en cliquant sur la barre de progression mobile (réservé au Master)
if (nowPlayingCard) {
  nowPlayingCard.addEventListener('click', (e) => {
    const track = e.target.closest('#mobile-progress-track');
    if (track) {
      if (myRole !== 'Master') {
        showToast("Seul le Master peut modifier la position de lecture !", "error");
        return;
      }
      if (!currentVideoDuration || currentVideoDuration <= 0) return;
      
      const rect = track.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const width = rect.width;
      const percentage = Math.max(0, Math.min(1, clickX / width));
      const targetSeconds = percentage * currentVideoDuration;
      
      console.log(`[Mobile Seek] Position: ${clickX}/${width} (${Math.round(percentage * 100)}%), cible: ${targetSeconds}s`);
      
      // Sauvegarder localement immédiatement pour que le re-render ne perde pas la position
      lastKnownProgressTime = targetSeconds;
      lastKnownProgressPercent = percentage * 100;
      
      // Notifier le serveur de la commande seek
      socket.emit('player_command', { action: 'seek', value: targetSeconds });
      
      // Mettre à jour immédiatement l'interface locale pour plus de réactivité
      const fill = document.getElementById('mobile-progress-fill');
      const curr = document.getElementById('mobile-progress-current');
      if (fill) fill.style.width = `${percentage * 100}%`;
      if (curr) curr.textContent = formatTime(targetSeconds);
    }
  });
}

// --- SYNC ÉGALISEUR SELON PLAY/PAUSE ---
function syncEqualizerState() {
  const eq = document.getElementById('mobile-equalizer');
  if (!eq) return;
  if (isPlayingState) {
    eq.classList.remove('paused');
  } else {
    eq.classList.add('paused');
  }
}

// Fonction de sécurité pour échapper le HTML
function escapeHTML(str) {
  return str.replace(/[&<>'"]/g, 
    tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
  );
}

// Initialisation des icônes de démarrage
refreshIcons();

// ==========================================
// 8. SOIRÉE INTERACTIONS COLLECTIVES (RÉACTIONS, VETO, FAIR-PLAY)
// ==========================================

// 1. Bouton de Veto (Skip collectif)
if (mobileVetoBtn) {
  mobileVetoBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    socket.emit('vote_veto');
    
    // Léger retour tactile visuel
    mobileVetoBtn.style.transform = 'scale(0.92)';
    setTimeout(() => {
      mobileVetoBtn.style.transform = 'scale(1)';
    }, 150);
  });
}

// 2. Boutons de réactions rapides d'émojis
document.addEventListener('click', (e) => {
  const reactionBtn = e.target.closest('.reaction-btn');
  if (reactionBtn) {
    e.stopPropagation();
    const type = reactionBtn.getAttribute('data-type');
    socket.emit('emoji_reaction', { type });
    
    // Effet d'enfoncement visuel du bouton cliqué
    reactionBtn.style.transform = 'scale(0.85)';
    reactionBtn.style.background = 'var(--primary-glow)';
    setTimeout(() => {
      reactionBtn.style.transform = 'scale(1)';
      reactionBtn.style.background = 'rgba(255, 255, 255, 0.03)';
    }, 150);
  }
});

// 3. Commutateur Fair-Play
if (mobileFairplayCheckbox) {
  mobileFairplayCheckbox.addEventListener('change', (e) => {
    if (myRole !== 'Master') return;
    socket.emit('toggle_fairplay', { value: e.target.checked });
  });
}

function updateMobileVetoCount(count, required) {
  if (!mobileVetoBtn || !mobileVetoCount || !mobileVetoRequired) return;
  
  mobileVetoCount.textContent = count;
  mobileVetoRequired.textContent = required;
  
  if (count > 0) {
    // Si l'utilisateur ou la foule a déjà voté, on met le bouton en surbrillance
    mobileVetoBtn.style.background = 'rgba(244, 63, 94, 0.25)';
    mobileVetoBtn.style.borderColor = 'var(--danger)';
    mobileVetoBtn.style.boxShadow = '0 0 10px rgba(244, 63, 94, 0.2)';
  } else {
    // Réinitialisation par défaut
    mobileVetoBtn.style.background = 'rgba(244, 63, 94, 0.1)';
    mobileVetoBtn.style.borderColor = 'rgba(244, 63, 94, 0.25)';
    mobileVetoBtn.style.boxShadow = 'none';
  }
}

function updateMobileFairPlayCheckbox(isActive) {
  if (mobileFairplayCheckbox) {
    mobileFairplayCheckbox.checked = !!isActive;
  }
}
