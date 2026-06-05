// Initialize socket connection
const socket = io();

// Chargement dynamique de l'Iframe API YouTube (indispensable pour l'initialisation du lecteur)
if (!window.YT) {
  const tag = document.createElement('script');
  tag.src = "https://www.youtube.com/iframe_api";
  const firstScriptTag = document.getElementsByTagName('script')[0];
  firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
}

let player = null;
let currentVideo = null;
let skipSegments = [];
let sponsorBlockInterval = null;
let isPlayerReady = false;
let currentVolume = 100;
let tvDragStartIndex = null;
let pendingVideoToLoad = null;
let progressInterval = null; // Interval pour broadcaster la progression aux mobiles
let isTransitioning = false; // Flag pour savoir si on charge une nouvelle vidéo (évite la boucle de pause infinie)
let tvQueue = []; // Sauvegarde de la file d'attente pour la notification de transition

function loadVideoNow(video) {
  if (!player || typeof player.loadVideoById !== 'function') return;
  isTransitioning = true; // Début du chargement d'un nouveau clip
  player.loadVideoById(video.id);
  
  // Mettre à jour l'Ambilight en arrière-plan
  const amb = document.getElementById('ambilight-bg');
  if (amb) {
    amb.style.backgroundImage = `url(https://i.ytimg.com/vi/${video.id}/hqdefault.jpg)`;
  }
  
  try {
    player.unMute();
    player.setVolume(currentVolume);
  } catch (e) {}
}

// DOM Elements
const idleOverlay = document.getElementById('idle-overlay');
const qrImage = document.getElementById('qr-image');
const tvUrl = document.getElementById('tv-url');
const toast = document.getElementById('toast');
const toastThumbnail = document.getElementById('toast-thumbnail');
const toastVideoTitle = document.getElementById('toast-video-title');
const toastUsername = document.getElementById('toast-username');

const adminBtn = document.getElementById('admin-btn');
const closeAdminBtn = document.getElementById('close-admin-btn');
const adminPanel = document.getElementById('admin-panel');
const clientList = document.getElementById('client-list');

// TV Overlay Elements
const tvControlsOverlay = document.getElementById('tv-controls-overlay');
const tvOverlayQrImage = document.getElementById('tv-overlay-qr-image');
const tvOverlayUrl = document.getElementById('tv-overlay-url');
const tvOverlayTitle = document.getElementById('tv-overlay-title');
const tvOverlayUsername = document.getElementById('tv-overlay-username');
const tvOverlayDuration = document.getElementById('tv-overlay-duration');
const tvPlayBtn = document.getElementById('tv-play-btn');
const tvSkipBtn = document.getElementById('tv-skip-btn');

// ==========================================
// 1. DÉMARRAGE ET INITIALISATION CONFIG
// ==========================================
async function initConfig() {
  try {
    const response = await fetch('/api/config');
    const config = await response.json();
    
    // Configurer le QR code et le lien affichés à l'écran (Veille)
    qrImage.src = config.qrCodeDataUrl;
    tvUrl.textContent = config.mobileUrl;

    // Configurer le QR code et le lien affichés sur l'overlay TV
    if (tvOverlayQrImage) tvOverlayQrImage.src = config.qrCodeDataUrl;
    if (tvOverlayUrl) tvOverlayUrl.textContent = config.mobileUrl;
    
    console.log('Configuration chargée avec succès ! URL mobile :', config.mobileUrl);
  } catch (err) {
    console.error('Erreur lors de la récupération de la configuration du serveur:', err);
    tvUrl.textContent = "Erreur connexion serveur";
  }
}

// Lancer le chargement de la config serveur
initConfig();

// Enregistrement en tant qu'écran principal (TV) auprès du WebSocket
socket.on('connect', () => {
  console.log('Connecté au serveur Socket.io en tant qu\'écran principal.');
  socket.emit('join', { type: 'screen' });
});

// Réinitialisation de Lucide Icons
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
  
  // Conserver les classes et styles inline de manière robuste (compatible SVG/Lucide)
  const classes = el.getAttribute('class');
  if (classes) newEl.setAttribute('class', classes);
  const style = el.getAttribute('style');
  if (style) newEl.setAttribute('style', style);
  
  el.parentNode.replaceChild(newEl, el);
}
refreshIcons();

// ==========================================
// 2. LOGIQUE DU PANNEAU D'ADMINISTRATION
// ==========================================
adminBtn.addEventListener('click', () => {
  adminPanel.classList.toggle('active');
});

closeAdminBtn.addEventListener('click', () => {
  adminPanel.classList.remove('active');
});

// Écouter les mises à jour d'état du serveur pour actualiser la liste des invités et de la file d'attente
socket.on('state_update', (data) => {
  renderClientList(data.clients);
  renderTvOverlayQueueList(data.queue);
  if (typeof updateTvVetoCount === 'function') {
    updateTvVetoCount(data.vetoVotesCount, data.vetoVotesRequired);
  }
  if (typeof updateTvFairPlayCheckbox === 'function') {
    updateTvFairPlayCheckbox(data.isFairPlayActive);
  }
});

// Écouter également les modifications de playlist pour l'overlay TV
socket.on('queue_updated', (data) => {
  renderTvOverlayQueueList(data.queue);
});

function renderClientList(clients) {
  clientList.innerHTML = '';
  
  // Filtrer pour n'afficher que les mobiles (exclure l'écran lui-même)
  const mobileClients = clients.filter(c => c.id !== socket.id);
  
  if (mobileClients.length === 0) {
    clientList.innerHTML = `
      <li style="color: var(--text-muted); font-size: 0.9rem; text-align: center; padding: 1rem;">
        Aucun mobile connecté
      </li>
    `;
    return;
  }
  
  mobileClients.forEach(client => {
    const li = document.createElement('li');
    li.className = `client-item ${client.role === 'Master' ? 'is-master' : ''}`;
    
    const isMasterChecked = client.role === 'Master' ? 'checked' : '';
    
    li.innerHTML = `
      <div class="client-info">
        <span class="client-name">${escapeHTML(client.nickname)}</span>
        <span class="client-role ${client.role === 'Master' ? 'master' : ''}">
          ${client.role === 'Master' ? '👑 Master (Contrôle)' : '👤 Guest (Invité)'}
        </span>
      </div>
      <label class="switch">
        <input type="checkbox" data-socket-id="${client.id}" ${isMasterChecked} class="role-checkbox">
        <span class="slider"></span>
      </label>
    `;
    
    // Attacher l'événement pour changer le rôle
    const checkbox = li.querySelector('.role-checkbox');
    checkbox.addEventListener('change', (e) => {
      const targetId = e.target.getAttribute('data-socket-id');
      const newRole = e.target.checked ? 'Master' : 'Guest';
      
      console.log(`Demande de changement de rôle pour ${targetId} vers ${newRole}`);
      socket.emit('role_change', {
        targetSocketId: targetId,
        newRole: newRole
      });
    });
    
    clientList.appendChild(li);
  });
}

// Fonction de sécurité pour échapper le HTML
function escapeHTML(str) {
  return str.replace(/[&<>'"]/g, 
    tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
  );
}

// ==========================================
// 3. YOUTUBE IFRAME PLAYER API
// ==========================================

// Appelée automatiquement par l'API Youtube
function onYouTubeIframeAPIReady() {
  console.log('Iframe YouTube API prête. Initialisation du lecteur...');
  
  player = new YT.Player('player', {
    height: '100%',
    width: '100%',
    videoId: '', // Commencer vide
    playerVars: {
      'autoplay': 1,
      'controls': 0,        // Masquer les contrôles natifs
      'disablekb': 1,       // Désactiver les touches clavier
      'fs': 0,              // Désactiver le bouton plein écran
      'rel': 0,             // Désactiver les vidéos associées
      'modestbranding': 1,  // Masquer le logo YT autant que possible
      'iv_load_policy': 3   // Masquer les annotations de vidéo
    },
    events: {
      'onReady': onPlayerReady,
      'onStateChange': onPlayerStateChange,
      'onError': onPlayerError
    }
  });
}

function onPlayerReady(event) {
  isPlayerReady = true;
  console.log('Lecteur YouTube prêt et fonctionnel.');
  if (pendingVideoToLoad) {
    console.log("Chargement de la vidéo en attente :", pendingVideoToLoad.title);
    loadVideoNow(pendingVideoToLoad);
    pendingVideoToLoad = null;
  }
}

function onPlayerStateChange(event) {
  // Gérer le cas du démarrage d'une vidéo
  if (event.data === YT.PlayerState.PLAYING) {
    isTransitioning = false; // Transition terminée avec succès
    if (currentVideo) {
      // Envoyer confirmation au serveur
      socket.emit('video_started', currentVideo);
      
      // Afficher le toast de notification
      showToast(currentVideo);
 
      // Appliquer de force le volume actuel à chaque clip pour éviter les réinitialisations YT
      try {
        player.unMute();
        player.setVolume(currentVolume);
      } catch (e) {}
    }
    
    // Démarrer la surveillance SponsorBlock
    startSponsorBlockTimer();
 
    // Démarrer le broadcast de progression
    startProgressBroadcast();
 
    // Mettre à jour l'icône de l'overlay TV
    updatePlayPauseTVIcon(true);

    // Mettre à jour le HUD en mode lecture (montre play puis s'efface après 800ms)
    updatePlayPauseHUD('play');
    
    // Afficher temporairement l'overlay et lancer le masquage automatique
    showTVOverlay();
  } else {
    // Stopper le timer si pas en cours de lecture
    stopSponsorBlockTimer();
    stopProgressBroadcast(false);
 
    if (event.data === YT.PlayerState.PAUSED) {
      updatePlayPauseTVIcon(false);
      // Notifier le serveur pour synchroniser l'état pause sur tous les mobiles uniquement si ce n'est pas une transition automatique
      if (!isTransitioning) {
        socket.emit('player_command', { action: 'pause' });
      }
      
      // Mettre à jour le HUD en mode pause (montre pause et reste visible)
      updatePlayPauseHUD('pause');
      
      // Afficher l'overlay TV et le maintenir visible
      showTVOverlay();
    }
  }

  // Gérer le cas où la vidéo se termine
  if (event.data === YT.PlayerState.ENDED) {
    console.log('Fin de la vidéo en cours.');
    currentVideo = null;
    skipSegments = [];
    stopProgressBroadcast(true);
    updatePlayPauseTVIcon(false);
    updatePlayPauseHUD('hide');
    socket.emit('video_ended');
  }
}

// Met à jour l'icône Play/Pause sur l'overlay TV
function updatePlayPauseTVIcon(isPlaying) {
  if (isPlaying) {
    replaceIcon('tv-play-icon', 'pause');
  } else {
    replaceIcon('tv-play-icon', 'play');
  }
  refreshIcons();
}

let hudTimeout = null;

// Gère l'indicateur central HUD Play/Pause
function updatePlayPauseHUD(action) {
  const hud = document.getElementById('tv-play-pause-hud');
  if (!hud) return;
  
  clearTimeout(hudTimeout);
  
  if (action === 'play') {
    replaceIcon('tv-hud-icon', 'play');
    refreshIcons();
    hud.classList.add('show');
    
    // Masquer après 800ms
    hudTimeout = setTimeout(() => {
      hud.classList.remove('show');
    }, 800);
  } else if (action === 'pause') {
    replaceIcon('tv-hud-icon', 'pause');
    refreshIcons();
    hud.classList.add('show');
  } else if (action === 'hide') {
    hud.classList.remove('show');
  }
}


// ==========================================
// BROADCAST DE PROGRESSION (toutes les secondes)
// ==========================================
const tvProgressFill = document.getElementById('tv-progress-fill');
const tvProgressCurrent = document.getElementById('tv-progress-current');
const tvProgressTotal = document.getElementById('tv-progress-total');
const tvProgressTrack = document.getElementById('tv-progress-track');

if (tvProgressTrack) {
  tvProgressTrack.addEventListener('click', (e) => {
    if (!player || !isPlayerReady || typeof player.getDuration !== 'function') return;
    const rect = tvProgressTrack.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const width = rect.width;
    const percentage = Math.max(0, Math.min(1, clickX / width));
    const duration = player.getDuration();
    const targetSeconds = percentage * duration;
    
    console.log(`[PC Click Seek] Position: ${clickX}/${width} (${Math.round(percentage * 100)}%), cible: ${targetSeconds}s`);
    player.seekTo(targetSeconds, true);
    
    // Mettre à jour immédiatement la barre locale
    if (tvProgressFill) tvProgressFill.style.width = `${percentage * 100}%`;
    if (tvProgressCurrent) tvProgressCurrent.textContent = formatTime(targetSeconds);
    
    // Broadcaster aux mobiles
    socket.emit('progress_update', { currentTime: targetSeconds, duration, percent: percentage * 100 });
    
    showTVOverlay();
  });
}

function formatTime(seconds) {
  if (!seconds || isNaN(seconds)) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function startProgressBroadcast() {
  stopProgressBroadcast();
  progressInterval = setInterval(() => {
    if (!player || !isPlayerReady || typeof player.getCurrentTime !== 'function') return;
    const currentTime = player.getCurrentTime();
    const duration = player.getDuration();
    const percent = duration > 0 ? (currentTime / duration) * 100 : 0;

    // Mettre à jour la barre TV locale
    if (tvProgressFill) tvProgressFill.style.width = `${percent}%`;
    if (tvProgressCurrent) tvProgressCurrent.textContent = formatTime(currentTime);
    if (tvProgressTotal) tvProgressTotal.textContent = formatTime(duration);

    // Broadcaster aux mobiles
    socket.emit('progress_update', { currentTime, duration, percent });

    // Mettre à jour la notification de transition du prochain morceau
    updateNextUpToast(currentTime, duration);
  }, 1000);
}

function stopProgressBroadcast(resetUI = false) {
  if (progressInterval) {
    clearInterval(progressInterval);
    progressInterval = null;
  }
  if (resetUI) {
    // Réinitialiser la barre TV
    if (tvProgressFill) tvProgressFill.style.width = '0%';
    if (tvProgressCurrent) tvProgressCurrent.textContent = '0:00';
    if (tvProgressTotal) tvProgressTotal.textContent = '0:00';
  }
  
  // Masquer la notification de transition
  const nextUpToast = document.getElementById('next-up-toast');
  if (nextUpToast) {
    nextUpToast.classList.remove('active');
  }
}

function updateNextUpToast(currentTime, duration) {
  const toast = document.getElementById('next-up-toast');
  const img = document.getElementById('next-up-thumbnail');
  const countdown = document.getElementById('next-up-countdown');
  const title = document.getElementById('next-up-video-title');
  
  if (!toast || !img || !countdown || !title) return;
  
  // S'il n'y a pas de son dans la file ou si la durée est invalide
  if (!tvQueue || tvQueue.length === 0 || !duration || isNaN(duration)) {
    toast.classList.remove('active');
    return;
  }
  
  const remaining = Math.max(0, Math.ceil(duration - currentTime));
  
  // Si on est dans les 30 dernières secondes
  if (remaining <= 30 && remaining > 0) {
    const nextVideo = tvQueue[0]; // Le premier élément de la queue est le prochain son
    if (nextVideo) {
      img.src = nextVideo.thumbnail;
      title.textContent = nextVideo.title;
      countdown.textContent = `Son suivant dans ${remaining}s`;
      toast.classList.add('active');
    }
  } else {
    toast.classList.remove('active');
  }
}

function onPlayerError(event) {
  console.error('Erreur du lecteur YouTube :', event.data);
  // En cas d'erreur de lecture (bloquée, privée, etc.), on passe directement à la suivante
  setTimeout(() => {
    socket.emit('video_ended');
  }, 3000);
}

// ==========================================
// 4. INTÉGRATION DE SPONSORBLOCK (Saut Auto)
// ==========================================
async function fetchSponsorBlockSegments(videoId) {
  try {
    const res = await fetch(`/api/sponsorblock/${videoId}`);
    skipSegments = await res.json();
    if (skipSegments.length > 0) {
      console.log(`[SponsorBlock] ${skipSegments.length} segment(s) music_offtopic récupéré(s) pour la vidéo :`, skipSegments);
      // Initialise le flag de saut pour chaque segment
      skipSegments.forEach(s => s.skipped = false);
    } else {
      console.log('[SponsorBlock] Aucun segment non-musical répertorié.');
    }
  } catch (err) {
    console.error('Erreur lors du fetch SponsorBlock:', err);
    skipSegments = [];
  }
}

function startSponsorBlockTimer() {
  stopSponsorBlockTimer();
  
  sponsorBlockInterval = setInterval(() => {
    if (!player || !isPlayerReady || typeof player.getCurrentTime !== 'function') return;
    
    const currentTime = player.getCurrentTime();
    
    // Parcourir les segments récupérés
    for (const segment of skipSegments) {
      const [start, end] = segment.segment;
      
      // Réinitialiser le flag de saut si l'utilisateur revient manuellement en arrière avant le segment
      if (currentTime < start) {
        segment.skipped = false;
      }
      
      // Si la tête de lecture est dans un segment à sauter et n'a pas encore été sauté
      if (!segment.skipped && currentTime >= start && currentTime < end) {
        segment.skipped = true;
        console.log(`🔥 [SponsorBlock] Saut de l'intro/outro parlée détectée : ${start}s ➔ ${end}s`);
        player.seekTo(end, true);
        
        // Afficher une petite notification visuelle sur la TV
        showSponsorBlockToast();
        break; // Sortir de la boucle après le saut
      }
    }
  }, 250); // Surveillance toutes les 250ms pour une réactivité maximale
}

function stopSponsorBlockTimer() {
  if (sponsorBlockInterval) {
    clearInterval(sponsorBlockInterval);
    sponsorBlockInterval = null;
  }
}

// Petite bulle d'info discrète lors d'un saut
function showSponsorBlockToast() {
  const sbToast = document.createElement('div');
  sbToast.style.position = 'absolute';
  sbToast.style.top = '20px';
  sbToast.style.left = '20px';
  sbToast.style.background = 'rgba(16, 185, 129, 0.9)';
  sbToast.style.color = '#fff';
  sbToast.style.padding = '0.75rem 1.25rem';
  sbToast.style.borderRadius = '12px';
  sbToast.style.fontSize = '0.95rem';
  sbToast.style.fontWeight = '700';
  sbToast.style.zIndex = '999';
  sbToast.style.backdropFilter = 'blur(8px)';
  sbToast.style.boxShadow = '0 5px 15px rgba(16, 185, 129, 0.4)';
  sbToast.innerHTML = '<i data-lucide="skip-forward" style="vertical-align:middle; margin-right:6px; width:16px;"></i> SponsorBlock : Partie parlée sautée';
  
  document.querySelector('.tv-container').appendChild(sbToast);
  if (window.lucide) window.lucide.createIcons();
  
  setTimeout(() => {
    sbToast.style.transition = 'all 0.5s ease';
    sbToast.style.opacity = '0';
    sbToast.style.transform = 'translateY(-10px)';
    setTimeout(() => sbToast.remove(), 500);
  }, 3500);
}

// ==========================================
// 5. BANDEAU DE NOTIFICATION (TOAST)
// ==========================================
let toastTimeout = null;

function showToast(video) {
  if (toastTimeout) {
    clearTimeout(toastTimeout);
    toast.classList.remove('active');
  }
  
  // Configurer le bandeau
  toastThumbnail.src = video.thumbnail;
  toastVideoTitle.textContent = video.title;
  toastUsername.textContent = video.addedBy;
  
  // Attendre un court instant pour s'assurer que la classe est bien retirée et réappliquée
  setTimeout(() => {
    toast.classList.add('active');
    
    // Le masquer au bout de 5 secondes
    toastTimeout = setTimeout(() => {
      toast.classList.remove('active');
    }, 5000);
  }, 100);
}

// ==========================================
// 6. RÉCEPTION DES COMMANDES DE LECTURE (Socket.io)
// ==========================================
socket.on('tv_command', (command) => {
  console.log('Commande TV reçue du serveur :', command);
  
  if (command.action === 'load_video') {
    currentVideo = command.video;
    console.log(`Chargement d'une nouvelle vidéo : ${currentVideo.title}`);
    
    // Mettre à jour l'overlay de contrôles TV PC
    if (tvOverlayTitle) tvOverlayTitle.textContent = currentVideo.title;
    if (tvOverlayUsername) tvOverlayUsername.textContent = currentVideo.addedBy;
    if (tvOverlayDuration) tvOverlayDuration.textContent = currentVideo.duration || 'N/A';
    
    // Masquer l'overlay TV pour que seule la notification (Toast) apparaisse au début
    if (tvControlsOverlay) {
      tvControlsOverlay.classList.remove('visible');
    }

    // Cacher également le HUD
    updatePlayPauseHUD('hide');

    // Afficher le QR code pliable
    const qrCard = document.getElementById('tv-qr-card');
    if (qrCard) {
      qrCard.classList.remove('hidden-idle');
    }

    // Masquer la notification de transition
    const nextUpToast = document.getElementById('next-up-toast');
    if (nextUpToast) {
      nextUpToast.classList.remove('active');
    }

    // Masquer l'écran de veille
    idleOverlay.style.opacity = '0';
    setTimeout(() => {
      idleOverlay.style.display = 'none';
    }, 800);
    
    // Lancer la recherche SponsorBlock
    fetchSponsorBlockSegments(currentVideo.id);

    if (!player || !isPlayerReady) {
      console.log("Le lecteur YouTube n'est pas encore prêt. Vidéo mise en attente.");
      pendingVideoToLoad = currentVideo;
    } else {
      loadVideoNow(currentVideo);
    }
    return;
  }
  
  if (!player || !isPlayerReady) {
    console.warn('Le lecteur YouTube n\'est pas encore prêt.');
    return;
  }
  
  switch (command.action) {
    case 'play':
      player.playVideo();
      break;
      
    case 'pause':
      player.pauseVideo();
      break;
      
    case 'volume':
      // La valeur doit être comprise entre 0 et 100
      const volumeLevel = Math.max(0, Math.min(100, command.value));
      currentVolume = volumeLevel; // Mettre à jour la variable globale persistante sur le PC
      try {
        player.unMute(); // TRÈS IMPORTANT : S'assurer que le lecteur n'est pas "Muted" pour entendre le volume
        player.setVolume(currentVolume);
        console.log(`[Volume] Réglage du volume à ${currentVolume}%`);
      } catch (e) {
        console.warn("Erreur lors du réglage de volume YouTube:", e);
      }
      // Synchroniser le slider de volume de l'overlay TV
      const oTvVolSlider = document.getElementById('tv-vol-slider');
      const oTvVolText = document.getElementById('tv-vol-text');
      if (oTvVolSlider) oTvVolSlider.value = currentVolume;
      if (oTvVolText) oTvVolText.textContent = `${currentVolume}%`;
      if (typeof updateTvVolumeIcon === 'function') updateTvVolumeIcon(currentVolume);
      break;
      
    case 'seek':
      if (player && isPlayerReady && typeof player.seekTo === 'function') {
        const targetSeconds = parseFloat(command.value);
        console.log(`[Seek Command] Déplacement de la tête de lecture à ${targetSeconds}s`);
        player.seekTo(targetSeconds, true);
      }
      break;
      
    case 'show_idle':
      // Réinitialiser le lecteur
      player.stopVideo();
      currentVideo = null;
      skipSegments = [];
      stopProgressBroadcast(true);
      updatePlayPauseTVIcon(false);
      updatePlayPauseHUD('hide');
      
      // Nettoyer l'Ambilight
      const ambBg = document.getElementById('ambilight-bg');
      if (ambBg) {
        ambBg.style.backgroundImage = 'none';
      }
      
      // Masquer l'overlay TV
      if (tvControlsOverlay) tvControlsOverlay.classList.remove('visible');
      
      // Cacher le QR code de l'overlay et le replier
      const qrCard = document.getElementById('tv-qr-card');
      if (qrCard) {
        qrCard.classList.add('hidden-idle');
        qrCard.classList.add('collapsed');
        replaceIcon('tv-qr-chevron', 'chevron-down');
        refreshIcons();
      }
      
      // Afficher l'écran de veille
      idleOverlay.style.display = 'flex';
      setTimeout(() => {
        idleOverlay.style.opacity = '1';
      }, 50);
      break;
      
    default:
      console.warn('Commande inconnue :', command.action);
  }
});

// ==========================================
// 7. GESTION DU DÉBLOCAGE AUDIO DE L'AUTOPLAY
// ==========================================
function unlockAudio() {
  if (player && isPlayerReady) {
    try {
      player.unMute();
      player.setVolume(100);
      
      // Si une vidéo est chargée mais bloquée en pause par le navigateur
      if (currentVideo && typeof player.playVideo === 'function') {
        player.playVideo();
      }
    } catch (e) {
      console.warn("Erreur déblocage audio YouTube player:", e);
    }
  }
  console.log("Interaction utilisateur détectée : audio et autoplay débloqués.");
}

// Écouter le premier clic n'importe où sur la page pour débloquer l'audio si nécessaire
document.body.addEventListener('click', unlockAudio, { once: true });

// ==========================================
// 8. LOGIQUE D'AFFICHAGE/MASQUAGE DE L'OVERLAY TV & ACCÈS CLAVIER
// ==========================================
let overlayTimeout = null;

function showTVOverlay() {
  if (!currentVideo) return; // Ne pas afficher l'overlay si la file d'attente est inactive (veille)
  
  if (tvControlsOverlay) {
    tvControlsOverlay.classList.add('visible');
  }
  
  // Afficher le pointeur de la souris lors des mouvements
  document.body.style.cursor = 'default';
  
  clearTimeout(overlayTimeout);
  
  // Si le lecteur est en pause, on ne masque PAS l'overlay
  if (player && isPlayerReady && typeof player.getPlayerState === 'function') {
    if (player.getPlayerState() === YT.PlayerState.PAUSED) {
      return; // Ne pas masquer l'overlay quand la vidéo est en pause
    }
  }
  
  // Si le champ de recherche TV ou le panneau admin est actif, on ne masque PAS l'overlay
  const tvSearchInput = document.getElementById('tv-search-input');
  if (tvSearchInput && document.activeElement === tvSearchInput) {
    return;
  }
  const adminPanel = document.getElementById('admin-panel');
  if (adminPanel && adminPanel.classList.contains('active')) {
    return;
  }
  
  overlayTimeout = setTimeout(() => {
    if (tvControlsOverlay && currentVideo) {
      // De même, au moment de masquer, on vérifie à nouveau le focus et l'ouverture du panneau admin
      if (tvSearchInput && document.activeElement === tvSearchInput) {
        return;
      }
      if (adminPanel && adminPanel.classList.contains('active')) {
        return;
      }
      
      // On masque l'overlay uniquement si la vidéo n'est pas en pause
      if (player && isPlayerReady && typeof player.getPlayerState === 'function') {
        if (player.getPlayerState() === YT.PlayerState.PAUSED) {
          return;
        }
      }
      
      tvControlsOverlay.classList.remove('visible');
      // Cacher le pointeur pour une immersion totale style TV/Projecteur
      document.body.style.cursor = 'none';
    }
  }, 3000); // Disparaît après 3 secondes d'inactivité
}

// Écouter les interactions pour afficher l'overlay
let lastMouseX = null;
let lastMouseY = null;

document.addEventListener('mousemove', (e) => {
  // Ignorer les faux mouvements générés par le navigateur lors des reflows DOM (ex: chargement vidéo, toast, seek)
  if (e.clientX === lastMouseX && e.clientY === lastMouseY) return;
  lastMouseX = e.clientX;
  lastMouseY = e.clientY;
  showTVOverlay();
});
document.addEventListener('keydown', showTVOverlay);
document.addEventListener('click', (e) => {
  // Toujours afficher l'overlay au clic pour donner du feedback
  showTVOverlay();
  
  // Ignorer si on clique sur un bouton, un input, un slider, un lien, ou à l'intérieur d'un panneau/carte interactive
  if (
    e.target.closest('button') ||
    e.target.closest('input') ||
    e.target.closest('a') ||
    e.target.closest('.tv-collapsible-card') ||
    e.target.closest('#admin-panel') ||
    e.target.closest('#tv-search-results') ||
    e.target.closest('.tv-remove-item-btn') ||
    e.target.closest('.role-checkbox') ||
    e.target.closest('.switch') ||
    e.target.closest('#tv-progress-track')
  ) {
    return;
  }
  
  // Si on est en veille (pas de clip en cours), on ne fait rien de plus
  if (!currentVideo) return;
  
  // Sinon, basculer play/pause
  console.log('[Clic Écran TV] Clic dans le vide -> Toggle Play/Pause');
  togglePlayPauseTV();
});

// Gestion des touches du clavier pour l'Écran TV PC
document.addEventListener('keydown', (e) => {
  // Ignorer si une saisie est active (non applicable sur TV mais par précaution)
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  
  if (!player || !isPlayerReady || !currentVideo) return;
  
  if (e.code === 'Space') {
    e.preventDefault(); // Bloquer le scroll par défaut
    togglePlayPauseTV();
  } else if (e.code === 'ArrowRight') {
    e.preventDefault();
    console.log('[Clavier TV] Passer au morceau suivant (ArrowRight)');
    socket.emit('player_command', { action: 'skip' });
  } else if (e.code === 'ArrowLeft') {
    e.preventDefault();
    console.log('[Clavier TV] Retour au morceau précédent (ArrowLeft)');
    socket.emit('player_command', { action: 'previous' });
  }
});

// Bascule Play/Pause sur la TV
function togglePlayPauseTV() {
  if (!player || !isPlayerReady) return;
  const state = player.getPlayerState();
  if (state === YT.PlayerState.PLAYING) {
    player.pauseVideo();
    socket.emit('player_command', { action: 'pause' }); // Synchronise le bouton sur tous les mobiles connectés !
  } else {
    player.playVideo();
    socket.emit('player_command', { action: 'play' }); // Synchronise le bouton sur tous les mobiles connectés !
  }
}

// Clics sur les boutons de l'overlay de contrôles TV PC
if (tvPlayBtn) {
  tvPlayBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    togglePlayPauseTV();
  });
}

if (tvSkipBtn) {
  tvSkipBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    console.log('[Clic Overlay TV] Passer au morceau suivant (Skip)');
    socket.emit('player_command', { action: 'skip' });
  });
}

const tvPrevBtn = document.getElementById('tv-prev-btn');
if (tvPrevBtn) {
  tvPrevBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    console.log('[Clic Overlay TV] Retour au morceau précédent (Previous)');
    socket.emit('player_command', { action: 'previous' });
  });
}

// Rendu de la playlist à suivre sur l'overlay TV
const tvOverlayQueueList = document.getElementById('tv-overlay-queue-list');

function renderTvOverlayQueueList(queue) {
  tvQueue = queue; // Sauvegarder la file d'attente locale
  if (!tvOverlayQueueList) return;
  tvOverlayQueueList.innerHTML = '';
  
  if (queue.length === 0) {
    tvOverlayQueueList.innerHTML = `
      <li style="color: var(--text-muted); font-size: 0.75rem; text-align: center; padding: 1.5rem 0; font-style: italic;">
        Aucun clip à suivre
      </li>
    `;
    return;
  }
  
  queue.forEach((item, index) => {
    const li = document.createElement('li');
    li.className = 'tv-queue-item';
    li.setAttribute('draggable', 'true');
    li.dataset.index = index;
    
    li.innerHTML = `
      <div class="tv-drag-handle" style="cursor: grab; display: flex; align-items: center; justify-content: center; color: var(--text-muted); width: 20px; height: 100%; flex-shrink: 0;" title="Faire glisser pour réordonner">
        <i data-lucide="grip-vertical" style="width: 14px; height: 14px;"></i>
      </div>
      <span style="font-size: 0.72rem; font-weight: 800; color: var(--primary); width: 15px; text-align: center;">#${index + 1}</span>
      <img src="${item.thumbnail}" alt="" style="width: 40px; height: 28px; object-fit: cover; border-radius: 4px; flex-shrink: 0;">
      <div style="flex: 1; min-width: 0;">
        <div style="font-size: 0.75rem; font-weight: 600; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHTML(item.title)}</div>
        <div style="font-size: 0.65rem; color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">Par ${escapeHTML(item.addedBy)}</div>
      </div>
      <button class="tv-remove-item-btn" data-queue-id="${item.queueId}" style="background: none; border: none; color: var(--text-muted); cursor: pointer; width: 22px; height: 22px; display: flex; align-items: center; justify-content: center; border-radius: 50%; transition: all 0.2s;" title="Retirer de la file">
        <i data-lucide="trash-2" style="width: 12px; height: 12px;"></i>
      </button>
    `;
    
    // Attacher l'événement au bouton supprimer
    const removeBtn = li.querySelector('.tv-remove-item-btn');
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const qId = removeBtn.getAttribute('data-queue-id');
      console.log(`[TV Screen] Demande de retrait du morceau ID ${qId} de la playlist`);
      socket.emit('player_command', { action: 'remove', queueId: qId });
    });
    
    // Hover effects
    removeBtn.addEventListener('mouseenter', () => {
      removeBtn.style.background = 'rgba(244, 63, 94, 0.1)';
      removeBtn.style.color = 'var(--danger)';
    });
    removeBtn.addEventListener('mouseleave', () => {
      removeBtn.style.background = 'none';
      removeBtn.style.color = 'var(--text-muted)';
    });

    // Événements Drag & Drop (PC/Souris)
    li.addEventListener('dragstart', (e) => {
      tvDragStartIndex = index;
      li.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', index.toString());
      showTVOverlay();
    });

    li.addEventListener('dragover', (e) => {
      e.preventDefault();
      showTVOverlay();

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
        console.log(`[TV Screen] Réorganisation de la file : de #${fromIndex} à #${toIndex}`);
        socket.emit('reorder_queue', { fromIndex, toIndex });
      }
    });

    li.addEventListener('dragend', () => {
      li.classList.remove('dragging');
      document.querySelectorAll('.tv-queue-item').forEach(el => {
        el.classList.remove('drag-insert-before', 'drag-insert-after');
      });
      tvDragStartIndex = null;
      showTVOverlay();
    });
    
    tvOverlayQueueList.appendChild(li);
  });
  
  refreshIcons();
}

// Gestion du range slider de volume sur l'overlay TV PC
const tvVolSlider = document.getElementById('tv-vol-slider');
const tvVolText = document.getElementById('tv-vol-text');

if (tvVolSlider) {
  // Configurer la valeur de départ
  tvVolSlider.value = currentVolume;
  if (tvVolText) tvVolText.textContent = `${currentVolume}%`;
  
  tvVolSlider.addEventListener('input', (e) => {
    e.stopPropagation();
    const val = parseInt(e.target.value, 10);
    currentVolume = val;
    
    if (tvVolText) tvVolText.textContent = `${currentVolume}%`;
    
    // Mettre à jour l'icône de volume TV
    updateTvVolumeIcon(currentVolume);
    
    // Mettre à jour le lecteur localement
    try {
      player.unMute();
      player.setVolume(currentVolume);
    } catch (err) {}
    
    // Notifier le serveur pour synchroniser tous les mobiles connectés
    socket.emit('player_command', { action: 'volume', value: currentVolume });
    
    // Garder l'overlay visible pendant qu'on ajuste le son
    showTVOverlay();
  });
}

function updateTvVolumeIcon(vol) {
  if (vol === 0) {
    replaceIcon('tv-vol-icon', 'volume-x');
  } else if (vol < 40) {
    replaceIcon('tv-vol-icon', 'volume-1');
  } else {
    replaceIcon('tv-vol-icon', 'volume-2');
  }
  refreshIcons();
}

// ==========================================
// 9. RECHERCHE DIRECTE & NAVIGATION AU CLAVIER SUR LA TV (PC)
// ==========================================
const tvSearchInput = document.getElementById('tv-search-input');
const tvSearchResults = document.getElementById('tv-search-results');
let tvSearchTimeout = null;
let tvSelectedResultIndex = -1;
let tvSearchResultsList = [];

if (tvSearchInput) {
  // Empêcher les touches globales (comme Espace) d'activer Play/Pause pendant qu'on tape
  tvSearchInput.addEventListener('keydown', (e) => {
    e.stopPropagation(); // Évite le comportement global de keydown de la page
    
    if (!tvSearchResults.classList.contains('active')) return;
    
    const items = tvSearchResults.querySelectorAll('.tv-search-item');
    if (items.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      tvSelectedResultIndex = (tvSelectedResultIndex + 1) % items.length;
      updateTvSearchSelection(items);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      tvSelectedResultIndex = (tvSelectedResultIndex - 1 + items.length) % items.length;
      updateTvSearchSelection(items);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (tvSelectedResultIndex >= 0 && tvSelectedResultIndex < tvSearchResultsList.length) {
        selectTvSearchResult(tvSearchResultsList[tvSelectedResultIndex]);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeTvSearch();
    }
  });

  tvSearchInput.addEventListener('input', () => {
    clearTimeout(tvSearchTimeout);
    const query = tvSearchInput.value.trim();

    if (!query) {
      tvSearchResults.innerHTML = '';
      tvSearchResults.classList.remove('active');
      tvSearchResultsList = [];
      tvSelectedResultIndex = -1;
      return;
    }

    // Lancement de la recherche avec debounce de 500ms
    tvSearchTimeout = setTimeout(() => {
      executeTvSearch(query);
    }, 500);
  });

  // Conserver l'overlay affiché lorsque l'input obtient le focus
  tvSearchInput.addEventListener('focus', () => {
    showTVOverlay();
  });
  
  // Fermer la recherche si clic en dehors
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.tv-search-container')) {
      closeTvSearch();
    }
  });
}

async function executeTvSearch(query) {
  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
    if (!res.ok) throw new Error('Échec de la recherche');
    
    tvSearchResultsList = await res.json();
    renderTvSearchResults();
  } catch (err) {
    console.error('Erreur de recherche sur TV:', err);
    tvSearchResults.innerHTML = `<li style="padding: 0.8rem; color: var(--danger); font-size: 0.8rem; text-align: center;">Erreur réseau</li>`;
    tvSearchResults.classList.add('active');
  }
}

function renderTvSearchResults() {
  tvSearchResults.innerHTML = '';
  tvSelectedResultIndex = -1;

  if (tvSearchResultsList.length === 0) {
    tvSearchResults.innerHTML = `<li style="padding: 0.8rem; color: var(--text-muted); font-size: 0.8rem; text-align: center;">Aucun résultat</li>`;
    tvSearchResults.classList.add('active');
    return;
  }

  tvSearchResultsList.forEach((video, index) => {
    const li = document.createElement('li');
    li.className = 'tv-search-item';
    li.innerHTML = `
      <img src="${video.thumbnail}" alt="miniature">
      <div class="tv-search-item-info">
        <h5 class="tv-search-item-title">${escapeHTML(video.title)}</h5>
        <span class="tv-search-item-duration">${video.duration}</span>
      </div>
    `;

    // Événement clic souris standard
    li.addEventListener('click', (e) => {
      e.stopPropagation();
      selectTvSearchResult(video);
    });

    tvSearchResults.appendChild(li);
  });

  tvSearchResults.classList.add('active');
}

function updateTvSearchSelection(items) {
  items.forEach((item, index) => {
    if (index === tvSelectedResultIndex) {
      item.classList.add('selected');
      // Scroll automatique si besoin
      item.scrollIntoView({ block: 'nearest' });
    } else {
      item.classList.remove('selected');
    }
  });
}

function selectTvSearchResult(video) {
  console.log(`[TV Search] Vidéo sélectionnée depuis l'Écran Principal :`, video.title);
  
  // Ajouter à la file d'attente (avec attribution spéciale pour l'écran)
  socket.emit('add_to_queue', {
    id: video.id,
    title: video.title,
    thumbnail: video.thumbnail,
    duration: video.duration
  });

  // Toast visuel pour la TV
  const notificationToast = {
    title: video.title,
    thumbnail: video.thumbnail,
    addedBy: "Écran Principal"
  };
  showToast(notificationToast);

  // Vider et fermer le champ de recherche
  closeTvSearch();
}

function closeTvSearch() {
  if (tvSearchInput) {
    tvSearchInput.value = '';
    tvSearchInput.blur();
  }
  if (tvSearchResults) {
    tvSearchResults.innerHTML = '';
    tvSearchResults.classList.remove('active');
  }
  tvSearchResultsList = [];
  tvSelectedResultIndex = -1;
  
  // Masquer l'overlay après le délai normal
  showTVOverlay();
}

// ==========================================
// 10. OVERLAY RÉACTIONS LIVE & VETO & FAIRPLAY
// ==========================================

socket.on('emoji_reaction', (data) => {
  createFloatingEmoji(data.type);
});

function createFloatingEmoji(type) {
  const container = document.getElementById('tv-reactions-container');
  if (!container) return;
  
  const emojiDiv = document.createElement('div');
  emojiDiv.className = 'floating-emoji';
  
  let emoji = '🔥';
  if (type === 'fire') emoji = '🔥';
  else if (type === 'dance') emoji = '💃';
  else if (type === 'beer') emoji = '🍻';
  else if (type === 'party') emoji = '🎉';
  else if (type === 'hundred') emoji = '💯';
  
  emojiDiv.textContent = emoji;
  
  // Position X aléatoire (5% à 95%)
  const randomX = Math.random() * 90 + 5;
  emojiDiv.style.left = `${randomX}%`;
  
  // Durée d'animation aléatoire
  const randomDuration = Math.random() * 1.5 + 2.0;
  emojiDiv.style.animationDuration = `${randomDuration}s`;
  
  // Taille aléatoire
  const randomScale = Math.random() * 0.4 + 0.8;
  emojiDiv.style.fontSize = `${randomScale * 2.5}rem`;
  
  container.appendChild(emojiDiv);
  
  // Nettoyer après la fin de l'animation
  setTimeout(() => {
    emojiDiv.remove();
  }, randomDuration * 1000);
}

function updateTvVetoCount(count, required) {
  const badge = document.getElementById('tv-veto-badge');
  const countSpan = document.getElementById('tv-veto-count');
  const requiredSpan = document.getElementById('tv-veto-required');
  
  if (!badge || !countSpan || !requiredSpan) return;
  
  if (count > 0 && currentVideo) {
    countSpan.textContent = count;
    requiredSpan.textContent = required;
    badge.style.display = 'flex';
  } else {
    badge.style.display = 'none';
  }
}

function updateTvFairPlayCheckbox(isActive) {
  const checkbox = document.getElementById('tv-fairplay-checkbox');
  if (checkbox) {
    checkbox.checked = !!isActive;
  }
}

// Lier l'événement de bascule Fair-Play
document.addEventListener('DOMContentLoaded', () => {
  const tvFairplayCheckbox = document.getElementById('tv-fairplay-checkbox');
  if (tvFairplayCheckbox) {
    tvFairplayCheckbox.addEventListener('change', (e) => {
      socket.emit('toggle_fairplay', { value: e.target.checked });
    });
  }
  initCollapsibleCards();
});
// En dehors du DOMContentLoaded pour le chargement immédiat au cas où
const tvFairplayCheckboxInit = document.getElementById('tv-fairplay-checkbox');
if (tvFairplayCheckboxInit) {
  tvFairplayCheckboxInit.addEventListener('change', (e) => {
    socket.emit('toggle_fairplay', { value: e.target.checked });
  });
}
initCollapsibleCards();

// ==========================================
// 11. GESTION DES CARTES REPLIABLES (QR CODE & FILE D'ATTENTE)
// ==========================================
function initCollapsibleCards() {
  const qrCard = document.getElementById('tv-qr-card');
  const queueCard = document.getElementById('tv-queue-card');
  
  if (qrCard) {
    if (!qrCard.dataset.listenerAttached) {
      qrCard.dataset.listenerAttached = 'true';
      qrCard.addEventListener('click', (e) => {
        if (qrCard.classList.contains('collapsed')) {
          qrCard.classList.remove('collapsed');
          replaceIcon('tv-qr-chevron', 'chevron-up');
          refreshIcons();
          showTVOverlay();
        } else {
          // Si dépliée, replier seulement en cliquant sur l'en-tête
          if (e.target.closest('.tv-card-header')) {
            qrCard.classList.add('collapsed');
            replaceIcon('tv-qr-chevron', 'chevron-down');
            refreshIcons();
            showTVOverlay();
          }
        }
      });
    }
  }
  
  if (queueCard) {
    if (!queueCard.dataset.listenerAttached) {
      queueCard.dataset.listenerAttached = 'true';
      queueCard.addEventListener('click', (e) => {
        if (queueCard.classList.contains('collapsed')) {
          queueCard.classList.remove('collapsed');
          replaceIcon('tv-queue-chevron', 'chevron-up');
          refreshIcons();
          showTVOverlay();
        } else {
          // Si dépliée, replier seulement en cliquant sur l'en-tête
          if (e.target.closest('.tv-card-header')) {
            queueCard.classList.add('collapsed');
            replaceIcon('tv-queue-chevron', 'chevron-down');
            refreshIcons();
            showTVOverlay();
          }
        }
      });
    }
  }
}

// ==========================================
// 12. FULLSCREEN & LIVE CHAT MARQUEE TV LOGIC
// ==========================================

const tvFsBtn = document.getElementById('tv-fullscreen-btn');
if (tvFsBtn) {
  tvFsBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleFullscreen();
  });
}

function toggleFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(err => {
      console.error(`Erreur d'activation du plein écran: ${err.message}`);
    });
  } else {
    document.exitFullscreen();
  }
}

document.addEventListener('fullscreenchange', () => {
  if (document.fullscreenElement) {
    replaceIcon('tv-fs-icon', 'shrink');
  } else {
    replaceIcon('tv-fs-icon', 'expand');
  }
  refreshIcons();
});

// Bind 'F' key for Fullscreen (Space, ArrowRight, ArrowLeft are already bounded)
document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  if (e.key.toLowerCase() === 'f') {
    e.preventDefault();
    toggleFullscreen();
  }
});

// Chat Marquee Listener
socket.on('new_chat_message', (msg) => {
  createScrollingChatMsg(msg);
});

function createScrollingChatMsg(msg) {
  const container = document.getElementById('tv-chat-marquee-container');
  if (!container) return;

  const msgDiv = document.createElement('div');
  msgDiv.className = 'marquee-msg';

  let roleBadge = '👤';
  if (msg.role === 'Master') roleBadge = '👑';
  else if (msg.role === 'Screen') roleBadge = '📺';

  msgDiv.innerHTML = `
    <span style="color: var(--primary); font-weight: 800; font-size: 0.9em; margin-right: 6px;">${roleBadge} ${escapeHTML(msg.nickname)}:</span>
    <span style="color: #fff;">${escapeHTML(msg.text)}</span>
  `;

  // Track allocation (up to 3 tracks) to prevent layout overlaps
  const activeMessages = container.querySelectorAll('.marquee-msg');
  let track = 0;
  const tracksUsed = new Set();
  activeMessages.forEach(m => {
    if (m.dataset.track) {
      tracksUsed.add(parseInt(m.dataset.track, 10));
    }
  });

  for (let i = 0; i < 3; i++) {
    if (!tracksUsed.has(i)) {
      track = i;
      break;
    }
  }

  msgDiv.dataset.track = track;
  msgDiv.style.top = `${track * 45}px`;

  container.appendChild(msgDiv);

  // Remove element after marquee finishes running
  setTimeout(() => {
    msgDiv.remove();
  }, 8500);
}
