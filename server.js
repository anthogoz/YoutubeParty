const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const qrcode = require('qrcode');
const os = require('os');
const https = require('https');
const path = require('path');
const fs = require('fs');

// ==========================================
// CONFIGURATION & VARIABLES GLOBALES
// ==========================================
const PORT = 3000;
// Optionnel : Ajoutez votre clé API YouTube v3 ici pour l'utiliser comme fallback
const YOUTUBE_API_KEY = null; 

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Servir les fichiers statiques du dossier 'public'
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

const MASTERS_FILE = path.join(__dirname, 'masters.json');

// Structure de l'état global en mémoire
let queue = [];         // Liste des vidéos en attente
let currentVideo = null; // Vidéo actuellement en cours de lecture
let isPlaying = false;  // État de lecture actuel (play/pause)
let history = [];       // Historique des vidéos jouées pour retour arrière
let clients = {};       // Liste des clients connectés : { socketId: { id, nickname, role, userId, device } }
let screenSocketId = null; // Socket ID de l'écran principal (PC)
let isFairPlayActive = true; // Activer le mode playlist équitable par défaut
let vetoVotes = new Set();  // Set des userId ayant voté Veto pour la vidéo en cours

// Charger les Masters persistés au démarrage
let masterUserIds = new Set();
try {
  if (fs.existsSync(MASTERS_FILE)) {
    const data = fs.readFileSync(MASTERS_FILE, 'utf8');
    const list = JSON.parse(data);
    masterUserIds = new Set(list);
    console.log(`[Persistance] ${masterUserIds.size} Master(s) restauré(s) depuis masters.json.`);
  }
} catch (e) {
  console.error('[Persistance] Impossible de charger masters.json :', e.message);
}

// Fonction pour sauvegarder les Masters sur disque
function saveMasters() {
  try {
    const list = Array.from(masterUserIds);
    fs.writeFileSync(MASTERS_FILE, JSON.stringify(list, null, 2), 'utf8');
  } catch (e) {
    console.error('[Persistance] Impossible de sauvegarder masters.json :', e.message);
  }
}

// ==========================================
// DÉTECTION AUTO DE L'IP LOCALE
// ==========================================
function getLocalIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      // Filtrer pour IPv4 et ignorer les adresses internes (loopback / 127.0.0.1)
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

const LOCAL_IP = getLocalIp();
const MOBILE_URL = `http://${LOCAL_IP}:${PORT}/mobile.html`;

// ==========================================
// ENDPOINT : CONFIG & QR CODE
// ==========================================
app.get('/api/config', async (req, res) => {
  try {
    const qrCodeDataUrl = await qrcode.toDataURL(MOBILE_URL);
    res.json({
      localIp: LOCAL_IP,
      port: PORT,
      mobileUrl: MOBILE_URL,
      qrCodeDataUrl: qrCodeDataUrl
    });
  } catch (err) {
    console.error('Erreur lors de la génération du QR Code:', err);
    res.status(500).json({ error: 'Erreur génération QR Code' });
  }
});

// ==========================================
// PROXY SPONSORBLOCK AVEC BASCULEMENT AUTO (RÉSILIENT AUX PANNES SERVEUR)
// ==========================================
app.get('/api/sponsorblock/:videoId', (req, res) => {
  const videoId = req.params.videoId;
  const categories = JSON.stringify(["music_offtopic", "sponsor"]);
  const encodedCategories = encodeURIComponent(categories);
  
  // Liste des instances API SponsorBlock (Serveur officiel + miroirs de secours)
  const instances = [
    `https://sponsor.ajay.app/api/skipSegments?videoID=${videoId}&categories=${encodedCategories}`,
    `https://sponsorblock.kavin.rocks/api/skipSegments?videoID=${videoId}&categories=${encodedCategories}`,
    `https://sponsorblock.hostux.net/api/skipSegments?videoID=${videoId}&categories=${encodedCategories}`,
    `https://sponsorblock.2255.me/api/skipSegments?videoID=${videoId}&categories=${encodedCategories}`
  ];
  
  let index = 0;
  
  function tryNext() {
    if (index >= instances.length) {
      console.warn(`[SponsorBlock] Toutes les instances ont échoué ou retourné 404 pour la vidéo ID : ${videoId}`);
      return res.json([]);
    }
    
    const url = instances[index];
    const hostname = new URL(url).hostname;
    console.log(`[SponsorBlock] Tentative sur l'instance #${index + 1} : ${hostname}...`);
    
    https.get(url, (sbRes) => {
      let data = '';
      sbRes.on('data', (chunk) => { data += chunk; });
      sbRes.on('end', () => {
        if (sbRes.statusCode === 200) {
          try {
            const segments = JSON.parse(data);
            console.log(`[SponsorBlock] Succès sur l'instance ${hostname} !`);
            return res.json(segments);
          } catch (e) {
            console.error(`[SponsorBlock] Erreur de parsing JSON sur ${hostname}`);
            index++;
            tryNext();
          }
        } else if (sbRes.statusCode === 404 || sbRes.statusCode === 400) {
          // Si le serveur répond 404 ou 400, cela signifie légitimement qu'aucun segment n'a été créé pour ce clip
          console.log(`[SponsorBlock] Réponse ${sbRes.statusCode} sur ${hostname} : aucun segment répertorié.`);
          return res.json([]);
        } else {
          // Erreur serveur (ex: 502, 503, 504), essayer le serveur suivant
          console.warn(`[SponsorBlock] Instance ${hostname} indisponible (Code HTTP : ${sbRes.statusCode}). Basculement sur l'instance suivante...`);
          index++;
          tryNext();
        }
      });
    }).on('error', (err) => {
      console.warn(`[SponsorBlock] Erreur réseau sur ${hostname} : ${err.message}. Basculement sur l'instance suivante...`);
      index++;
      tryNext();
    });
  }
  
  tryNext();
});

// ==========================================
// OUTILS DE RÉSOLUTION DE LIENS ET RECHERCHE YOUTUBE
// ==========================================

// Extrait l'ID de la vidéo depuis une URL YouTube ou valide un ID brut de 11 caractères
function extractVideoId(text) {
  const regex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/;
  const match = text.match(regex);
  if (match) return match[1];
  
  // Validation d'un ID brut
  const idRegex = /^[a-zA-Z0-9_-]{11}$/;
  if (idRegex.test(text)) return text;
  
  return null;
}

// Interroge l'API OEmbed publique de YouTube pour récupérer le titre et la miniature d'un ID
function fetchVideoDetailsOEmbed(videoId, callback) {
  const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
  
  https.get(oembedUrl, (res) => {
    let data = '';
    res.on('data', (chunk) => { data += chunk; });
    res.on('end', () => {
      try {
        if (res.statusCode === 200) {
          const info = JSON.parse(data);
          callback(null, {
            id: videoId,
            title: info.title || 'Vidéo YouTube',
            thumbnail: info.thumbnail_url || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
            duration: 'Lien'
          });
        } else {
          callback(new Error('Vidéo introuvable via OEmbed'));
        }
      } catch (e) {
        callback(e);
      }
    });
  }).on('error', (err) => {
    callback(err);
  });
}

// PROXY RECHERCHE YOUTUBE
app.get('/api/search', (req, res) => {
  const query = req.query.q;
  if (!query) {
    return res.json([]);
  }

  // 1. Détecter si l'utilisateur a collé une URL ou un ID vidéo direct
  const videoId = extractVideoId(query);
  if (videoId) {
    console.log(`[Recherche] Lien/ID YouTube détecté : ${videoId}. Résolution directe...`);
    fetchVideoDetailsOEmbed(videoId, (err, video) => {
      if (!err && video) {
        return res.json([video]);
      }
      console.warn(`[Recherche] Échec résolution OEmbed pour ${videoId}, bascule sur la recherche classique...`);
      performGeneralSearch(query, res);
    });
  } else {
    performGeneralSearch(query, res);
  }
});

function performGeneralSearch(query, res) {
  // 1. Essai avec l'API YouTube officielle si une clé est fournie
  if (YOUTUBE_API_KEY) {
    const apiUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&maxResults=15&q=${encodeURIComponent(query)}&type=video&key=${YOUTUBE_API_KEY}`;
    https.get(apiUrl, (apiRes) => {
      let data = '';
      apiRes.on('data', (chunk) => { data += chunk; });
      apiRes.on('end', () => {
        try {
          const result = JSON.parse(data);
          if (result.items) {
            const videos = result.items.map(item => ({
              id: item.id.videoId,
              title: item.snippet.title,
              thumbnail: item.snippet.thumbnails.medium ? item.snippet.thumbnails.medium.url : item.snippet.thumbnails.default.url,
              duration: 'N/A'
            }));
            return res.json(videos);
          }
          throw new Error('Format de réponse invalide');
        } catch (e) {
          console.warn('API YouTube en échec, bascule sur le scraping...', e.message);
          searchByScraping(query, res);
        }
      });
    }).on('error', () => {
      searchByScraping(query, res);
    });
  } else {
    // 2. Scraping natif direct sans clé API
    searchByScraping(query, res);
  }
}

// Fonction de scraping de recherche YouTube
function searchByScraping(query, res) {
  const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&sp=EgIQAQ%253D%253D`;
  
  const options = {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
      // Cookie essentiel pour bypasser le bandeau de consentement de cookies européen de YouTube
      'Cookie': 'CONSENT=YES+cb.20210328-17-p0.fr+FX+943;'
    }
  };

  https.get(searchUrl, options, (ytRes) => {
    let html = '';
    ytRes.on('data', (chunk) => { html += chunk; });
    ytRes.on('end', () => {
      try {
        // CORRECTION MAJEURE : Recherche multi-ligne via [\s\S] car le JSON de YouTube contient des retours à la ligne
        const regex = /ytInitialData\s*=\s*({[\s\S]*?});/;
        const match = html.match(regex);
        if (!match) {
          throw new Error('ytInitialData introuvable (possible blocage temporaire ou changement de structure de YouTube)');
        }

        const dataObj = JSON.parse(match[1]);
        const contents = dataObj.contents.twoColumnSearchResultsRenderer.primaryContents.sectionListRenderer.contents[0].itemSectionRenderer.contents;
        
        const videos = [];
        for (const item of contents) {
          if (item.videoRenderer) {
            const vr = item.videoRenderer;
            const videoId = vr.videoId;
            const title = vr.title?.runs?.[0]?.text || 'Sans titre';
            const thumbnail = vr.thumbnail?.thumbnails?.[0]?.url || '';
            const duration = vr.lengthText?.simpleText || 'N/A';

            if (videoId) {
              videos.push({
                id: videoId,
                title: title,
                thumbnail: thumbnail,
                duration: duration
              });
            }
          }
        }
        res.json(videos.slice(0, 15));
      } catch (err) {
        console.error('Erreur scraping YouTube search:', err.message);
        res.status(500).json({ error: 'Échec de la recherche automatique. Collez directement un lien de vidéo YouTube !' });
      }
    });
  }).on('error', (err) => {
    console.error('Erreur réseau lors du scraping:', err.message);
    res.status(500).json({ error: 'Erreur réseau vers YouTube.' });
  });
}

// ==========================================
// SOCKET.IO : TEMPS RÉEL
// ==========================================
io.on('connection', (socket) => {
  console.log(`Nouvelle connexion socket : ${socket.id}`);

  // Envoi initial des informations de connexion
  socket.emit('connection_established', { socketId: socket.id });

  // 1. Appareil rejoint (soit l'Écran principal PC, soit un Mobile)
  socket.on('join', (data) => {
    const { type, nickname, userId } = data;

    if (type === 'screen') {
      screenSocketId = socket.id;
      console.log(`L'écran principal PC s'est enregistré (${socket.id})`);
      sendGlobalState();

      // Si une vidéo était déjà en cours côté serveur, on force le nouvel écran connecté à la charger
      if (currentVideo) {
        socket.emit('tv_command', { action: 'load_video', video: currentVideo });
      } else if (queue.length > 0) {
        playNextVideo();
      }
    } else if (type === 'mobile') {
      // Déterminer le rôle : Master s'il était déjà enregistré dans la session active
      const wasMaster = userId && masterUserIds.has(userId);
      const role = wasMaster ? 'Master' : 'Guest';

      // Ajouter aux clients mobiles connectés
      clients[socket.id] = {
        id: socket.id,
        nickname: nickname || `Invité-${socket.id.slice(0, 4)}`,
        role: role,
        userId: userId,
        device: socket.handshake.headers['user-agent'] ? 'Smartphone' : 'Unknown'
      };
      console.log(`Mobile connecté : ${clients[socket.id].nickname} [${role}] (ID Persistant: ${userId})`);
      
      // Notifier le mobile de son rôle
      socket.emit('role_updated', role);
      
      // Mettre à jour l'écran et les autres mobiles
      sendGlobalState();
    }
  });

  // 2. Un mobile ou l'écran principal ajoute une vidéo à la file d'attente
  socket.on('add_to_queue', (videoData) => {
    const client = clients[socket.id];
    const isScreen = socket.id === screenSocketId;
    if (!client && !isScreen) return;

    const nickname = isScreen ? "Écran Principal" : client.nickname;

    const newItem = {
      queueId: '_' + Math.random().toString(36).substr(2, 9), // ID unique dans la playlist locale
      id: videoData.id,
      title: videoData.title,
      thumbnail: videoData.thumbnail,
      duration: videoData.duration,
      addedBy: nickname,
      addedById: socket.id,
      upvotes: [],
      addedAt: Date.now()
    };

    queue.push(newItem);
    console.log(`Vidéo ajoutée par ${nickname} : ${newItem.title}`);

    // APPLIQUER LE FAIR-PLAY SI ACTIF
    if (isFairPlayActive && queue.length > 1) {
      queue = reorderFairPlay(queue);
    } else if (!isFairPlayActive && queue.length > 1) {
      queue.sort((a, b) => {
        const votesA = a.upvotes ? a.upvotes.length : 0;
        const votesB = b.upvotes ? b.upvotes.length : 0;
        if (votesB !== votesA) return votesB - votesA;
        return a.addedAt - b.addedAt;
      });
    }

    // Diffuser la file d'attente mise à jour
    io.emit('queue_updated', { queue, currentVideo, isPlaying });

    // Si aucune vidéo ne tourne actuellement, notifier l'écran de lancer celle-ci !
    if (!currentVideo && screenSocketId) {
      playNextVideo();
    }
  });

  // 2b. Ajouter une vidéo EN PREMIER dans la file d'attente (Master seulement)
  socket.on('add_to_queue_first', (videoData) => {
    const client = clients[socket.id];
    const isScreen = socket.id === screenSocketId;
    if (!client && !isScreen) return;

    // Vérifier les droits (Master ou écran)
    const isMaster = client ? (client.role === 'Master') : false;
    if (!isMaster && !isScreen) {
      socket.emit('error_message', "Action non autorisée. Seul le Master peut placer une vidéo en premier.");
      return;
    }

    const nickname = isScreen ? "Écran Principal" : client.nickname;

    const newItem = {
      queueId: '_' + Math.random().toString(36).substr(2, 9),
      id: videoData.id,
      title: videoData.title,
      thumbnail: videoData.thumbnail,
      duration: videoData.duration,
      addedBy: nickname,
      addedById: socket.id,
      upvotes: [],
      addedAt: Date.now()
    };

    queue.unshift(newItem); // Placer EN PREMIER
    console.log(`[PRIORITÉ] Vidéo placée en tête de file par ${nickname} : ${newItem.title}`);

    io.emit('queue_updated', { queue, currentVideo, isPlaying });

    if (!currentVideo && screenSocketId) {
      playNextVideo();
    }
  });

  // 3. Changement de rôle d'un client mobile (décidé par l'écran principal)
  socket.on('role_change', (data) => {
    const { targetSocketId, newRole } = data;
    
    // Vérification de sécurité : Seul l'écran principal ou un Master peut attribuer des rôles
    if (socket.id === screenSocketId || (clients[socket.id] && clients[socket.id].role === 'Master')) {
      const targetClient = clients[targetSocketId];
      if (targetClient) {
        targetClient.role = newRole;
        
        // Mettre à jour le registre persistant en mémoire et sur disque
        if (targetClient.userId) {
          if (newRole === 'Master') {
            masterUserIds.add(targetClient.userId);
            console.log(`[Persistance] ID ${targetClient.userId} promu Master dans masterUserIds.`);
          } else {
            masterUserIds.delete(targetClient.userId);
            console.log(`[Persistance] ID ${targetClient.userId} retire de masterUserIds.`);
          }
          saveMasters();
        }
        
        console.log(`Le rôle de ${targetClient.nickname} a été modifié en [${newRole}]`);
        
        // Notifier le mobile concerné de son changement de rôle
        io.to(targetSocketId).emit('role_updated', newRole);
        
        // Diffuser l'état mis à jour à tous
        sendGlobalState();
      }
    }
  });

  // 4. Commande de lecture du lecteur YouTube (Play/Pause/Skip/Previous/Volume/Remove)
  socket.on('player_command', (data) => {
    const client = clients[socket.id];
    const isScreen = socket.id === screenSocketId;
    
    if (!client && !isScreen) return;
    
    const isMaster = client ? (client.role === 'Master') : false;
    
    // Autoriser Play et Pause pour TOUT LE MONDE (Master + Guest + Écran TV)
    if (data.action === 'play' || data.action === 'pause') {
      console.log(`Commande de lecture '${data.action}' reçue.`);
      isPlaying = (data.action === 'play');
      // Diffuser à TOUT LE MONDE pour synchronisation bilatérale instantanée
      io.emit('tv_command', data);
    } 
    // Autoriser la suppression de chanson sous conditions (mobiles et écran PC)
    else if (data.action === 'remove' && data.queueId) {
      const item = queue.find(x => x.queueId === data.queueId);
      
      // Un utilisateur peut supprimer s'il est Master OR s'il s'agit de l'écran PC OR s'il a lui-même ajouté la vidéo
      if (isMaster || isScreen || (item && item.addedById === socket.id)) {
        console.log(`Vidéo retirée par ${isScreen ? 'l\'Écran TV' : client.nickname} : ${item ? item.title : 'inconnu'}`);
        queue = queue.filter(item => item.queueId !== data.queueId);
        io.emit('queue_updated', { queue, currentVideo });
      } else {
        socket.emit('error_message', "Action non autorisée. Vous ne pouvez retirer que vos propres vidéos.");
      }
    } 
    // Réserver le Skip (Zapping), Previous, Volume et Seek au Master ou à l'écran TV lui-même
    else if (data.action === 'skip' || data.action === 'previous' || data.action === 'volume' || data.action === 'seek') {
      if (isMaster || isScreen) {
        console.log(`Commande d'administration ${data.action} reçue.`);
        if (data.action === 'skip') {
          playNextVideo();
        } else if (data.action === 'previous') {
          playPreviousVideo(socket);
        } else {
          if (screenSocketId) {
            io.to(screenSocketId).emit('tv_command', data);
          }
        }
      } else {
        socket.emit('error_message', "Action non autorisée. Seul le 'Master' ou l'écran TV peut effectuer cette action.");
      }
    }

  });

  // 4.5. Réordonner la file d'attente (Master ou Écran TV)
  socket.on('reorder_queue', (data) => {
    const client = clients[socket.id];
    const isScreen = socket.id === screenSocketId;
    if (!client && !isScreen) return;
    
    if (isScreen || (client && client.role === 'Master')) {
      const { fromIndex, toIndex } = data;
      if (fromIndex >= 0 && fromIndex < queue.length && toIndex >= 0 && toIndex < queue.length) {
        // Déplacer l'élément dans le tableau
        const [movedItem] = queue.splice(fromIndex, 1);
        queue.splice(toIndex, 0, movedItem);
        console.log(`[Queue] Réorganisée de #${fromIndex} vers #${toIndex} par ${isScreen ? 'l\'Écran TV' : client.nickname}`);
        
        // Diffuser la playlist mise à jour à tout le monde
        io.emit('queue_updated', { queue, currentVideo });
      }
    } else {
      socket.emit('error_message', "Action non autorisée. Seul le Master ou l'écran TV peut réorganiser la file d'attente.");
    }
  });

  // 4.6. Voter Veto (Skip collectif)
  socket.on('vote_veto', () => {
    const client = clients[socket.id];
    if (!client || !client.userId) return;
    
    if (vetoVotes.has(client.userId)) {
      vetoVotes.delete(client.userId);
      console.log(`[Veto] ${client.nickname} a retiré son vote.`);
    } else {
      vetoVotes.add(client.userId);
      console.log(`[Veto] ${client.nickname} a voté Veto.`);
    }
    
    checkVetoThreshold();
    sendGlobalState();
  });

  // 4.7. Activer/Désactiver Fair-Play
  socket.on('toggle_fairplay', (data) => {
    const client = clients[socket.id];
    const isScreen = socket.id === screenSocketId;
    
    if (isScreen || (client && client.role === 'Master')) {
      isFairPlayActive = !!data.value;
      console.log(`[Fair-Play] Commutateur basculé à ${isFairPlayActive}`);
      
      if (isFairPlayActive && queue.length > 1) {
        queue = reorderFairPlay(queue);
      } else if (!isFairPlayActive && queue.length > 1) {
        queue.sort((a, b) => {
          const votesA = a.upvotes ? a.upvotes.length : 0;
          const votesB = b.upvotes ? b.upvotes.length : 0;
          if (votesB !== votesA) return votesB - votesA;
          return a.addedAt - b.addedAt;
        });
      }
      
      io.emit('fairplay_updated', { isFairPlayActive });
      sendGlobalState();
    }
  });

  // 4.7b. Voter / Upvoter un morceau de la playlist
  socket.on('toggle_upvote', (data) => {
    const { queueId } = data;
    const client = clients[socket.id];
    if (!client || !client.userId) return;

    const item = queue.find(x => x.queueId === queueId);
    if (!item) return;

    if (!item.upvotes) item.upvotes = [];

    const idx = item.upvotes.indexOf(client.userId);
    if (idx >= 0) {
      item.upvotes.splice(idx, 1);
      console.log(`[Upvote] ${client.nickname} a retiré son vote pour : ${item.title}`);
    } else {
      item.upvotes.push(client.userId);
      console.log(`[Upvote] ${client.nickname} a voté pour : ${item.title}`);
    }

    // Si Fair-Play n'est pas actif, retrier la file
    if (!isFairPlayActive && queue.length > 1) {
      queue.sort((a, b) => {
        const votesA = a.upvotes ? a.upvotes.length : 0;
        const votesB = b.upvotes ? b.upvotes.length : 0;
        if (votesB !== votesA) return votesB - votesA;
        return a.addedAt - b.addedAt;
      });
    }

    io.emit('queue_updated', { queue, currentVideo, isPlaying });
    sendGlobalState();
  });

  // 4.7c. Envoyer un message sur le Chat Soirée
  socket.on('send_chat_message', (data) => {
    const client = clients[socket.id];
    const isScreen = socket.id === screenSocketId;
    if (!client && !isScreen) return;

    const nickname = isScreen ? "Écran Principal" : client.nickname;
    const role = isScreen ? "Screen" : client.role;
    const userId = isScreen ? "screen" : client.userId;

    const chatMsg = {
      id: '_' + Math.random().toString(36).substr(2, 9),
      nickname: nickname,
      role: role,
      userId: userId,
      text: data.text || '',
      timestamp: Date.now()
    };

    console.log(`[Chat] ${nickname} [${role}] : ${chatMsg.text}`);
    io.emit('new_chat_message', chatMsg);
  });

  // 4.8. Réception d'émojis réactions
  socket.on('emoji_reaction', (data) => {
    if (screenSocketId) {
      io.to(screenSocketId).emit('emoji_reaction', { type: data.type });
    }
  });

  // 4.9 Relais de la progression de lecture (depuis l'écran TV vers les mobiles)
  socket.on('progress_update', (data) => {
    if (socket.id !== screenSocketId) return;
    // Diffuser à tous les mobiles (pas à l'écran qui l'a envoyé)
    socket.broadcast.emit('progress_update', data);
  });

  // 5. L'écran TV confirme qu'une vidéo a bien démarré
  socket.on('video_started', (videoData) => {
    if (socket.id === screenSocketId) {
      currentVideo = videoData;
      isPlaying = true; // La vidéo vient de démarrer
      // Retirer de la file d'attente si elle y était encore
      queue = queue.filter(item => item.id !== videoData.id);
      
      console.log(`Lecture commencée sur la TV : ${videoData.title}`);
      io.emit('queue_updated', { queue, currentVideo, isPlaying });
      sendGlobalState();
    }
  });

  // 6. L'écran TV signale que la vidéo en cours est terminée
  socket.on('video_ended', () => {
    if (socket.id === screenSocketId) {
      console.log(`Vidéo terminée sur la TV.`);
      currentVideo = null;
      playNextVideo();
    }
  });

  // 7. Déconnexion d'un appareil
  socket.on('disconnect', () => {
    if (socket.id === screenSocketId) {
      console.log('Écran principal déconnecté !');
      screenSocketId = null;
    } else if (clients[socket.id]) {
      console.log(`Mobile déconnecté : ${clients[socket.id].nickname}`);
      const userId = clients[socket.id].userId;
      if (userId) {
        vetoVotes.delete(userId); // Enlever son vote veto
      }
      delete clients[socket.id];
      checkVetoThreshold(); // Re-calculer le seuil s'il y a moins de monde
      sendGlobalState();
    }
  });
});

// Lancer la vidéo suivante de la file d'attente
function playNextVideo() {
  vetoVotes.clear(); // Vider les vetos pour la nouvelle vidéo
  isPlaying = false; // Reset en attendant la confirmation video_started
  
  if (currentVideo) {
    history.push(currentVideo);
    if (history.length > 30) history.shift();
  }
  
  if (queue.length > 0) {
    currentVideo = queue.shift();
    console.log(`Lancement de la vidéo suivante : ${currentVideo.title}`);
    if (screenSocketId) {
      io.to(screenSocketId).emit('tv_command', { action: 'load_video', video: currentVideo });
    }
    io.emit('queue_updated', { queue, currentVideo, isPlaying });
  } else {
    currentVideo = null;
    console.log('La file d\'attente est vide.');
    if (screenSocketId) {
      io.to(screenSocketId).emit('tv_command', { action: 'show_idle' });
    }
    io.emit('queue_updated', { queue, currentVideo, isPlaying });
  }
}

// Revenir à la vidéo précédente
function playPreviousVideo(socketCall) {
  vetoVotes.clear(); // Vider les vetos pour la nouvelle vidéo
  isPlaying = false; // Reset en attendant la confirmation video_started
  
  if (history.length > 0) {
    const prev = history.pop();
    if (currentVideo) {
      queue.unshift(currentVideo); // Remettre au début de la queue
    }
    currentVideo = prev;
    console.log(`Lancement de la vidéo précédente : ${currentVideo.title}`);
    if (screenSocketId) {
      io.to(screenSocketId).emit('tv_command', { action: 'load_video', video: currentVideo });
    }
    io.emit('queue_updated', { queue, currentVideo, isPlaying });
  } else {
    if (socketCall) {
      socketCall.emit('error_message', "Aucun clip dans l'historique pour revenir en arrière.");
    }
  }
}

// Fonction utilitaire pour envoyer l'état global et les clients à tout le monde
function sendGlobalState() {
  io.emit('state_update', {
    queue,
    currentVideo,
    isPlaying,
    clients: Object.values(clients),
    mobileUrl: MOBILE_URL,
    isFairPlayActive,
    vetoVotesCount: vetoVotes.size,
    vetoVotesRequired: getVetoVotesRequired()
  });
}

function getVetoVotesRequired() {
  const activeMobileUsers = Object.values(clients).filter(c => c.id !== screenSocketId).length;
  return Math.max(1, Math.ceil(activeMobileUsers / 2));
}

function checkVetoThreshold() {
  if (!currentVideo) return;
  const required = getVetoVotesRequired();
  if (vetoVotes.size >= required) {
    console.log(`🗳️ [Veto] Le seuil de veto est atteint (${vetoVotes.size}/${required}). Passage automatique au clip suivant.`);
    playNextVideo();
  }
}

function reorderFairPlay(queueArray) {
  if (queueArray.length <= 1) return queueArray;
  
  // Group songs by user identifier (addedById)
  const userBuckets = {};
  const userOrder = [];
  
  queueArray.forEach(item => {
    const userId = item.addedById || 'anonymous';
    if (!userBuckets[userId]) {
      userBuckets[userId] = [];
      userOrder.push(userId);
    }
    userBuckets[userId].push(item);
  });
  
  const balanced = [];
  let songsRemaining = true;
  let round = 0;
  
  while (songsRemaining) {
    songsRemaining = false;
    userOrder.forEach(userId => {
      const bucket = userBuckets[userId];
      if (bucket && bucket.length > round) {
        balanced.push(bucket[round]);
        songsRemaining = true;
      }
    });
    round++;
  }
  
  return balanced;
}

// ==========================================
// DÉMARRAGE DU SERVEUR
// ==========================================
server.listen(PORT, '0.0.0.0', () => {
  console.log('==================================================');
  console.log('            🔥 YOUTUBEPARTY ACTIVE 🔥            ');
  console.log('==================================================');
  console.log(`💻 Écran TV (PC) : http://localhost:${PORT}/screen.html`);
  console.log(`📱 Télécommande Mobile : ${MOBILE_URL}`);
  console.log(`📡 Écoute sur le réseau Wi-Fi local port : ${PORT}`);
  console.log('==================================================');
});
