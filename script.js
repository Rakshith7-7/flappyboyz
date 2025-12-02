// Responsive canvas visual scaling helper
(function(){
  const canvas = document.getElementById("gameCanvas");
  if (!canvas) return;
  // Keep logical resolution attributes intact (360x640)
  const LOGICAL_W = parseInt(canvas.getAttribute("width"), 10) || 360;
  const LOGICAL_H = parseInt(canvas.getAttribute("height"), 10) || 640;

  // Make sure canvas CSS fills wrapper while keeping aspect ratio (CSS handles it).
  // But keep focus & pointer events enabled:
  canvas.style.display = "block";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.touchAction = "none";

  // Optional: handle resizing of the wrapper for centering / letterbox if needed.
  function onResize() {
    // nothing to change for game math because logical canvas attributes remain 360x640
    // clear any css transforms
    canvas.style.transform = "";
  }
  window.addEventListener("resize", onResize);
  onResize();
})();


// ============================
// FLAPPY BOYZ — script.js
// Full game logic: store/unlock, powerups, auto-flap, highscore, safe item spawn, start/gameover.
// Includes bird draw fix (preserve aspect ratio) and smaller shadow/flame skins.
// Replace your existing script.js with this file.
// ============================

/* -------------------------
   STORAGE KEYS
   ------------------------- */
const HIGH_SCORE_KEY = "flappy_renzil_highscore";
const UNLOCKED_SKINS_KEY = "flappy_renzil_unlocked_skins";
const SELECTED_SKIN_KEY = "flappy_renzil_selected_skin";

/* -------------------------
   DOM & ASSETS
   ------------------------- */
const BG_SRC     = "images/bg.png";
const PERSON_SRC = "images/person.png";
const BRICK_SRC  = "images/brick.png";

const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

const startScreen = document.getElementById("startScreen");
const startBtn = document.getElementById("startBtn");
const muteBtn = document.getElementById("muteBtn");
const resetHighBtn = document.getElementById("resetHighBtn");
const openStoreBtn = document.getElementById("openStoreBtn");
const storeScreen = document.getElementById("storeScreen");
const closeStoreBtn = document.getElementById("closeStoreBtn");
const skinsGrid = document.getElementById("skinsGrid");
const startHighScoreEl = document.getElementById("startHighScore");
const gameOverScreen = document.getElementById("gameOverScreen");
const gameOverGif = document.getElementById("gameOverGif");

// Audio elements (IDs must exist in HTML)
const music = document.getElementById("bgMusic");
const startSound = document.getElementById("startSound");
const jumpSound = document.getElementById("jumpSound");
const hitSound = document.getElementById("hitSound");

// power-up audios
const audio_item_shield = document.getElementById("audio_item_shield");
const audio_item_chili  = document.getElementById("audio_item_chili");
const audio_item_dynam  = document.getElementById("audio_item_dynam");
const audio_item_star   = document.getElementById("audio_item_star");
const audio_item_float  = document.getElementById("audio_item_float");
const audio_item_auto   = document.getElementById("audio_item_auto");
const audio_item_gold   = document.getElementById("audio_item_gold");

let audioMuted = false;
function setAllAudioMuted(mute) {
  audioMuted = !!mute;
  const all = [music,startSound,jumpSound,hitSound,
    audio_item_shield,audio_item_chili,audio_item_dynam,audio_item_star,
    audio_item_float,audio_item_auto,audio_item_gold];
  all.forEach(a => { try { if (a) a.muted = mute; } catch(e){} });
  updateMuteUI();
}
function updateMuteUI(){ muteBtn.textContent = audioMuted ? "🔇" : "🔊"; }

/* -------------------------
   SKINS CONFIG
   ------------------------- */
const SKINS = [
  { id: "default", name: "Renzil", img: "images/skins/skin_default.png", unlockScore: 0, scale: 1.0 },
  { id: "shadow",  name: "Alone", img: "images/skins/skin_shadow.png",  unlockScore: 50, scale: 1.21 },
  { id: "flame",   name: "Mabala",  img: "images/skins/skin_flame.png",   unlockScore: 75, scale: 1.15 }
];

// load unlocked / selected from storage
function loadUnlockedSkins() {
  try {
    const raw = localStorage.getItem(UNLOCKED_SKINS_KEY);
    if (!raw) return SKINS.filter(s=>s.unlockScore===0).map(s=>s.id);
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : SKINS.filter(s=>s.unlockScore===0).map(s=>s.id);
  } catch(e){ return SKINS.filter(s=>s.unlockScore===0).map(s=>s.id); }
}
function saveUnlockedSkins(arr) {
  try { localStorage.setItem(UNLOCKED_SKINS_KEY, JSON.stringify(arr)); } catch(e){}
}
function loadSelectedSkin() {
  try {
    const v = localStorage.getItem(SELECTED_SKIN_KEY);
    if (!v) return SKINS[0].id;
    return v;
  } catch(e){ return SKINS[0].id; }
}
function saveSelectedSkin(id) {
  try { localStorage.setItem(SELECTED_SKIN_KEY, id); } catch(e){}
}

let unlockedSkins = loadUnlockedSkins();
let selectedSkin = loadSelectedSkin();

/* -------------------------
   IMAGES
   ------------------------- */
// bird image that will be changed by applySelectedSkin()
const birdImg = new Image();

function applySelectedSkin() {
  const skin = SKINS.find(s=>s.id === selectedSkin) || SKINS[0];
  if (skin && skin.img) birdImg.src = skin.img;
  else birdImg.src = "images/player.png";

  // apply per-skin scale to BIRD_RADIUS
  const baseRadius = 30; // reference radius for default skin
  BIRD_RADIUS = Math.max(10, Math.round(baseRadius * (skin.scale || 1.0)));
}

// preload other images
const bgImg = new Image(); bgImg.src = BG_SRC;
const personImg = new Image(); personImg.src = PERSON_SRC;
const brickImg = new Image(); brickImg.src = BRICK_SRC;
const itemImages = {}; // for power-ups

function imgReady(img){ return img && img.complete && img.naturalWidth > 0 && img.naturalHeight > 0; }

/* -------------------------
   GAME CONSTANTS
   ------------------------- */
let BIRD_RADIUS = 30;              // updated per-skin
const GRAVITY_BASE  = 0.4;
const FLAP          = -5;
const PIPE_BASE_SPEED = 2;
const PIPE_WIDTH    = 78;
const PIPE_INTERVAL = 1900;
const OBSTACLE_MIN  = 110;
const OBSTACLE_MAX  = 160;
const DESIRED_BRICK_H = 100;
let BRICK_HEIGHT = DESIRED_BRICK_H;

/* power-up / items config */
const ITEM_SPAWN_INTERVAL = 4200;
const ITEM_SPAWN_PROB = 0.55;
const MAX_TOTAL_ACTIVE_ITEMS = 6;
const DURATION_INVINCIBLE = 7000;
const DURATION_SLOW       = 6000;
const DURATION_MULT       = 7000;
const DURATION_FLOAT      = 7000;
const DURATION_AUTO       = 6000;
const PIPE_CLEAR_BLOCK_MS = 1200;

const ITEM_TYPES = [
  { id:"shield",  name:"Shield",  img:"images/item_shield.png", audioEl:audio_item_shield, score:0,  behavior:"invincible", size:40, weight:1 },
  { id:"chili",   name:"Tailwind",img:"images/item_chili.png",  audioEl:audio_item_chili,  score:0,  behavior:"slow",       size:34, weight:1 },
  { id:"dynam",   name:"Dynamite",img:"images/item_dynam.png",  audioEl:audio_item_dynam,  score:0,  behavior:"clear_pipes",size:44, weight:1 },
  { id:"star",    name:"Star",    img:"images/item_star.png",   audioEl:audio_item_star,   score:0,  behavior:"mult",       size:40, weight:1 },
  { id:"feather", name:"Feather", img:"images/item_feather.png",audioEl:audio_item_float,  score:0,  behavior:"float",      size:36, weight:1 },
  { id:"auto",    name:"AutoFly", img:"images/item_auto.png",   audioEl:audio_item_auto,   score:0,  behavior:"auto",       size:42, weight:1 },
  { id:"gold",    name:"Golden",  img:"images/item_gold.png",   audioEl:audio_item_gold,   score:10, behavior:"points",     size:46, weight:1 }
];

// preload item images
for (const t of ITEM_TYPES) { const im = new Image(); im.src = t.img; itemImages[t.id] = im; }

/* -------------------------
   GAME STATE
   ------------------------- */
let bird = { x:80, y: canvas.height/2, vy:0 };
let pipes = [];
let lastPipeTime = 0;
let score = 0;
let isStarted = false;
let isGameOver = false;
let pipeTypeIndex = 0;

let collectibles = [];
let lastItemTime = 0;
let popups = [];

let speedMultiplier = 1.0;
const activeEffects = { invincibleUntil:0, slowUntil:0, multUntil:0, floatUntil:0, autoUntil:0, pipeSpawnBlockedUntil:0 };
let pipeScoreMultiplier = 1;
let autoTargetY = canvas.height/2;

/* -------------------------
   High score util
   ------------------------- */
function loadHighScore() {
  try { const v = localStorage.getItem(HIGH_SCORE_KEY); return v ? parseInt(v,10)||0 : 0; } catch(e){ return 0; }
}
function saveHighScore(val) { try { localStorage.setItem(HIGH_SCORE_KEY, String(val)); } catch(e){} }
let highScore = loadHighScore();

/* -------------------------
   STORE UI: render & interactions
   ------------------------- */
function openStore(){ startScreen.classList.add("hidden"); storeScreen.classList.remove("hidden"); renderSkinsGrid(); }
function closeStore(){ storeScreen.classList.add("hidden"); startScreen.classList.remove("hidden"); }

openStoreBtn.addEventListener("click", openStore);
closeStoreBtn.addEventListener("click", closeStore);

// render skins into grid
function renderSkinsGrid() {
  skinsGrid.innerHTML = "";
  for (const skin of SKINS) {
    const card = document.createElement("div");
    card.className = "skin-card";
    const img = document.createElement("img");
    img.src = skin.img;
    img.alt = skin.name;
    const name = document.createElement("div");
    name.className = "skin-name";
    name.textContent = skin.name;
    const req = document.createElement("div");
    req.className = "skin-req";
    if (isSkinUnlocked(skin.id)) req.textContent = "Unlocked";
    else req.textContent = `Unlock: score ${skin.unlockScore}`;
    const btn = document.createElement("button");
    btn.className = "skin-btn";
    if (isSkinUnlocked(skin.id)) {
      if (selectedSkin === skin.id) { btn.textContent = "Selected"; btn.disabled = true; card.classList.add("skin-selected"); }
      else { btn.textContent = "Select"; btn.onclick = ()=>{ selectSkin(skin.id); renderSkinsGrid(); }; }
    } else {
      btn.textContent = "Locked";
      btn.classList.add("locked");
      btn.disabled = true;
    }

    card.appendChild(img);
    card.appendChild(name);
    card.appendChild(req);
    card.appendChild(btn);
    skinsGrid.appendChild(card);
  }
}

// skin helpers
function isSkinUnlocked(id) { return unlockedSkins.indexOf(id) !== -1; }
function unlockSkin(id) {
  if (!isSkinUnlocked(id)) {
    unlockedSkins.push(id);
    saveUnlockedSkins(unlockedSkins);
    spawnPopup(canvas.width/2, canvas.height/2 - 40, `Unlocked: ${getSkinById(id).name}`);
  }
}
function getSkinById(id) { return SKINS.find(s=>s.id===id) || SKINS[0]; }
function selectSkin(id) {
  if (!isSkinUnlocked(id)) return;
  selectedSkin = id;
  saveSelectedSkin(id);
  applySelectedSkin();
  spawnPopup(canvas.width/2, canvas.height/2 - 20, `Selected: ${getSkinById(id).name}`);
}

/* ensure defaults exist */
if (!unlockedSkins || unlockedSkins.length === 0) {
  unlockedSkins = SKINS.filter(s=>s.unlockScore===0).map(s=>s.id);
  saveUnlockedSkins(unlockedSkins);
}
if (!selectedSkin || !isSkinUnlocked(selectedSkin)) {
  selectedSkin = SKINS[0].id;
  saveSelectedSkin(selectedSkin);
}
applySelectedSkin();

/* -------------------------
   Start / Gameover / Controls
   ------------------------- */
function updateStartHighScoreUI() { if (startHighScoreEl) startHighScoreEl.textContent = `High Score: ${highScore}`; }

function showStartScreen() {
  hideGameOverScreen();
  storeScreen.classList.add("hidden");
  startScreen.classList.remove("hidden");
  isStarted = false;
  drawBackground();
  drawBricks();
  ctx.fillStyle = "rgba(0,0,0,0.28)";
  ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.fillStyle = "white";
  ctx.font = "22px Arial";
  ctx.textAlign = "center";
  if (isGameOver && score > 0) {
    ctx.font = "28px Arial";
    ctx.fillText("GAME OVER", canvas.width/2, canvas.height/2 - 20);
    ctx.font = "18px Arial";
    ctx.fillText("Score: " + score, canvas.width/2, canvas.height/2 + 12);
  } else {
    ctx.font = "22px Arial";
    ctx.fillText("Tap to Start", canvas.width/2, canvas.height/2 + 60);
  }
  updateStartHighScoreUI();
}
function hideStartScreen(){ startScreen.classList.add("hidden"); }

function showGameOverScreen(){ hideStartScreen(); gameOverScreen.classList.remove("hidden"); }
function hideGameOverScreen(){ gameOverScreen.classList.add("hidden"); }

if (gameOverGif) {
  gameOverGif.addEventListener("click", ()=>{ hideGameOverScreen(); showStartScreen(); });
  gameOverScreen.addEventListener("click", (e)=>{ if (e.target === gameOverScreen){ hideGameOverScreen(); showStartScreen(); }});
}

startBtn.addEventListener("click", ()=>{ hideGameOverScreen(); startGame(); if (startSound) playStartSoundWithDucking(); });
muteBtn.addEventListener("click", ()=>{ setAllAudioMuted(!audioMuted); });
resetHighBtn.addEventListener("click", ()=>{ highScore = 0; saveHighScore(highScore); updateStartHighScoreUI(); spawnPopup(canvas.width/2, canvas.height/2 - 20, "High Score Reset"); });
document.addEventListener("keydown", (e)=> { if (!isStarted && (e.code==="Space" || e.code==="Enter")) startBtn.click(); });

/* -------------------------
   Audio ducking helper
   ------------------------- */
let musicDefaultVolume = 1.0;
let duckVolume = 0.25;
let duckRestoreDuration = 400;
function playStartSoundWithDucking() {
  if (!startSound) return;
  try {
    if (music && !audioMuted) {
      musicDefaultVolume = typeof music.volume === "number" ? music.volume : 1.0;
      music.volume = duckVolume;
    }
    startSound.currentTime = 0;
    const p = startSound.play();
    if (p && p.catch) p.catch(()=>{});
    startSound.onended = () => restoreMusicVolumeSmooth();
  } catch (e) { restoreMusicVolumeSmooth(); }
}
function restoreMusicVolumeSmooth() {
  if (!music || audioMuted) return;
  const from = music.volume; const to = musicDefaultVolume; const duration = duckRestoreDuration; const start = performance.now();
  function step(t){ const elapsed = t - start; const p = Math.min(1, elapsed / duration); music.volume = from + (to - from) * p; if (p < 1) requestAnimationFrame(step); else music.volume = to; }
  requestAnimationFrame(step);
}

/* -------------------------
   Controls: start / flap
   ------------------------- */
function startGame() {
  hideStartScreen();
  resetGame();
  isStarted = true;
  if (music && !audioMuted) try { music.currentTime = 0; music.volume = musicDefaultVolume; music.play().catch(()=>{}); } catch(e){}
}
function flap() {
  if (!isStarted) { startBtn.click(); return; }
  if (isGameOver) { showGameOverScreen(); return; }
  bird.vy = FLAP;
  if (jumpSound && !audioMuted) { try { jumpSound.currentTime = 0; jumpSound.play().catch(()=>{}); } catch(e){} }
}
canvas.addEventListener("touchstart", (e)=>{ e.preventDefault(); flap(); });
canvas.addEventListener("mousedown", flap);
document.addEventListener("keydown", (e)=> { if (e.code === "Space" || e.code === "ArrowUp") flap(); });

/* -------------------------
   Reset & pipes
   ------------------------- */
function resetGame() {
  if (imgReady(brickImg)) {
    const maxAllowedH = Math.floor(canvas.height * 0.45);
    BRICK_HEIGHT = Math.min(DESIRED_BRICK_H, maxAllowedH);
  } else BRICK_HEIGHT = DESIRED_BRICK_H;

  bird = { x:80, y: canvas.height/2, vy:0 };
  pipes = []; lastPipeTime = performance.now(); score = 0; isGameOver = false; pipeTypeIndex = 0;

  collectibles = []; lastItemTime = performance.now();
  popups = [];

  activeEffects.invincibleUntil = 0; activeEffects.slowUntil = 0; activeEffects.multUntil = 0;
  activeEffects.floatUntil = 0; activeEffects.autoUntil = 0; activeEffects.pipeSpawnBlockedUntil = 0;

  speedMultiplier = 1.0;
  pipeScoreMultiplier = 1;
  autoTargetY = canvas.height/2;

  // ensure selected skin is applied at run start (radius updated)
  applySelectedSkin();
}

function addPipe() {
  const height = Math.random() * (OBSTACLE_MAX - OBSTACLE_MIN) + OBSTACLE_MIN;
  const fromBottom = (pipeTypeIndex % 2 === 0);
  pipeTypeIndex++;
  pipes.push({ x: canvas.width, height: Math.round(height), fromBottom: fromBottom, scored: false });
}

/* -------------------------
   Item spawn & handling
   ------------------------- */
function pickItemTypeWeighted() {
  let total = 0;
  for (const t of ITEM_TYPES) total += t.weight;
  let r = Math.random() * total;
  for (const t of ITEM_TYPES) { if (r < t.weight) return t; r -= t.weight; }
  return ITEM_TYPES[0];
}
function countActiveOfType(typeId) { let c = 0; for (const it of collectibles) if (it.typeId === typeId) c++; return c; }

function spawnItem() {
  const now = performance.now();
  if (collectibles.length >= MAX_TOTAL_ACTIVE_ITEMS) return;
  if (now < activeEffects.pipeSpawnBlockedUntil) return;
  if (Math.random() > ITEM_SPAWN_PROB) return;

  let chosenType = null;
  for (let attempt=0; attempt<8; attempt++) {
    const t = pickItemTypeWeighted();
    const active = countActiveOfType(t.id);
    if (active < (t.maxActive || 3)) { chosenType = t; break; }
  }
  if (!chosenType) chosenType = ITEM_TYPES[Math.floor(Math.random()*ITEM_TYPES.length)];

  const size = chosenType.size || 36;

  // Find candidate pipe with gap large enough
  let candidatePipe = null;
  for (const p of pipes) {
    if (p.x > canvas.width * 0.2 && p.x < canvas.width * 0.95) {
      let gapTop, gapBottom;
      if (p.fromBottom) {
        const bottom = canvas.height - BRICK_HEIGHT;
        const topY = bottom - p.height;
        gapTop = BRICK_HEIGHT;
        gapBottom = topY;
      } else {
        const top = BRICK_HEIGHT;
        const bottomY = top + p.height;
        gapTop = bottomY;
        gapBottom = canvas.height - BRICK_HEIGHT;
      }
      const gapHeight = gapBottom - gapTop;
      const SAFETY = 18;
      if (gapHeight >= (size + SAFETY*2)) { candidatePipe = p; break; }
    }
  }

  let spawnX = canvas.width + 30;
  let spawnY;

  if (candidatePipe) {
    spawnX = candidatePipe.x + Math.round(PIPE_WIDTH / 2);
    if (candidatePipe.fromBottom) {
      const bottom = canvas.height - BRICK_HEIGHT;
      const topY = bottom - candidatePipe.height;
      const gapTop = BRICK_HEIGHT + 18;
      const gapBottom = topY - 18;
      spawnY = Math.random() * (gapBottom - gapTop) + gapTop;
    } else {
      const top = BRICK_HEIGHT;
      const bottomY = top + candidatePipe.height;
      const gapTop = bottomY + 18;
      const gapBottom = canvas.height - BRICK_HEIGHT - 18;
      spawnY = Math.random() * (gapBottom - gapTop) + gapTop;
    }
    spawnY = Math.max(BRICK_HEIGHT + 12, Math.min(spawnY, canvas.height - BRICK_HEIGHT - 12));
  } else {
    spawnX = canvas.width + 30;
    spawnY = Math.random() * (canvas.height - 2*BRICK_HEIGHT - 120) + BRICK_HEIGHT + 60;
    spawnY = Math.max(BRICK_HEIGHT + 18, Math.min(spawnY, canvas.height - BRICK_HEIGHT - 18));
  }

  collectibles.push({ id: 'it_' + Math.floor(Math.random()*100000), typeId: chosenType.id, x: spawnX, y: spawnY, size: size, createdAt: now });
}

function handleCollect(it) {
  const type = ITEM_TYPES.find(t=>t.id === it.typeId);
  if (!type) return;
  try { if (type.audioEl && !audioMuted) { type.audioEl.currentTime = 0; type.audioEl.play().catch(()=>{}); } } catch(e){}
  switch (type.behavior) {
    case "invincible": activeEffects.invincibleUntil = Math.max(activeEffects.invincibleUntil, performance.now() + DURATION_INVINCIBLE); spawnPopup(it.x, it.y, "Shield!"); break;
    case "slow": activeEffects.slowUntil = Math.max(activeEffects.slowUntil, performance.now() + DURATION_SLOW); spawnPopup(it.x, it.y, "Slow"); break;
    case "clear_pipes": pipes = []; activeEffects.pipeSpawnBlockedUntil = performance.now() + PIPE_CLEAR_BLOCK_MS; spawnPopup(it.x, it.y, "BOOM!"); break;
    case "mult": activeEffects.multUntil = Math.max(activeEffects.multUntil, performance.now() + DURATION_MULT); spawnPopup(it.x, it.y, "x2 Score"); break;
    case "float": activeEffects.floatUntil = Math.max(activeEffects.floatUntil, performance.now() + DURATION_FLOAT); spawnPopup(it.x, it.y, "Float"); break;
    case "auto": activeEffects.autoUntil = Math.max(activeEffects.autoUntil, performance.now() + DURATION_AUTO); autoTargetY = canvas.height / 2; spawnPopup(it.x, it.y, "Auto-Flight"); break;
    case "points": score += (type.score || 0); spawnPopup(it.x, it.y, "+" + (type.score || 0)); break;
    default: spawnPopup(it.x, it.y, ""); break;
  }
}

function updateCollectibles(delta, timestamp) {
  if (timestamp - lastItemTime > ITEM_SPAWN_INTERVAL) { spawnItem(); lastItemTime = timestamp; }
  for (let i = collectibles.length-1; i>=0; i--) {
    const it = collectibles[i];
    it.x -= PIPE_BASE_SPEED * speedMultiplier;
    if (it.x + it.size < -80) { collectibles.splice(i,1); continue; }
    const cx = it.x + it.size/2; const cy = it.y;
    const dx = bird.x - cx; const dy = bird.y - cy; const distSq = dx*dx + dy*dy; const hitR = BIRD_RADIUS + it.size*0.45;
    if (distSq <= hitR*hitR) { handleCollect(it); collectibles.splice(i,1); }
  }
}

/* -------------------------
   Popups
   ------------------------- */
function spawnPopup(x,y,text) { popups.push({ x, y, text, t:0, life:900 }); }
function updatePopups(delta) { for (let i = popups.length-1; i>=0; i--) { const p = popups[i]; p.t += delta; p.y -= 0.03 * delta; if (p.t > p.life) popups.splice(i,1); } }

/* -------------------------
   Auto-flap & update
   ------------------------- */
function update(delta, timestamp) {
  if (!isStarted) return;
  if (isGameOver) return;

  const now = performance.now();
  const invincible = now < activeEffects.invincibleUntil;
  if (now < activeEffects.slowUntil) speedMultiplier = 0.55; else speedMultiplier = 1.0;
  pipeScoreMultiplier = (now < activeEffects.multUntil) ? 2 : 1;
  let gravity = GRAVITY_BASE;
  if (now < activeEffects.floatUntil) gravity = GRAVITY_BASE * 0.45;
  const autoOn = now < activeEffects.autoUntil;

  if (!autoOn) bird.vy += gravity;
  else {
    // auto-flap: track gap of next pipe
    let nextPipe = null; let nearestX = Infinity;
    for (const p of pipes) { if (p.x < nearestX && p.x + PIPE_WIDTH > bird.x) { nearestX = p.x; nextPipe = p; } }
    let targetY = canvas.height / 2;
    const MARGIN_FROM_BRICKS = BIRD_RADIUS + 12;
    if (nextPipe) {
      if (nextPipe.fromBottom) {
        const bottom = canvas.height - BRICK_HEIGHT;
        const topY = bottom - nextPipe.height;
        const gapTop = BRICK_HEIGHT + 6; const gapBottom = topY - 6;
        targetY = Math.max(gapTop, Math.min(gapBottom, Math.round((gapTop + gapBottom)/2)));
      } else {
        const top = BRICK_HEIGHT;
        const bottomY = top + nextPipe.height;
        const gapTop = bottomY + 6; const gapBottom = canvas.height - BRICK_HEIGHT - 6;
        targetY = Math.max(gapTop, Math.min(gapBottom, Math.round((gapTop + gapBottom)/2)));
      }
    }
    const safeTop = BRICK_HEIGHT + MARGIN_FROM_BRICKS; const safeBottom = canvas.height - BRICK_HEIGHT - MARGIN_FROM_BRICKS;
    targetY = Math.max(safeTop, Math.min(safeBottom, targetY));
    autoTargetY = targetY;
    const distance = autoTargetY - bird.y; const desiredVy = distance * 0.018; const blend = 0.24;
    bird.vy += (desiredVy - bird.vy) * blend;
    bird.vy += gravity * 0.06;
    const MAX_VY = 8.0;
    if (bird.vy > MAX_VY) bird.vy = MAX_VY;
    if (bird.vy < -MAX_VY) bird.vy = -MAX_VY;
  }

  bird.y += bird.vy;

  // brick collision
  if (bird.y - BIRD_RADIUS < BRICK_HEIGHT || bird.y + BIRD_RADIUS > canvas.height - BRICK_HEIGHT) { triggerGameOver(); return; }

  // spawn pipes
  if (timestamp - lastPipeTime > PIPE_INTERVAL && timestamp > activeEffects.pipeSpawnBlockedUntil) { addPipe(); lastPipeTime = timestamp; }

  // update pipes
  for (let i = pipes.length-1; i>=0; i--) {
    const p = pipes[i];
    p.x -= PIPE_BASE_SPEED * speedMultiplier;
    if (!p.scored && p.x + PIPE_WIDTH < bird.x) {
      p.scored = true;
      score += (1 * pipeScoreMultiplier);
      checkSkinUnlocks(); // check unlocks each time score increases
    }
    if (p.x + PIPE_WIDTH < -120) pipes.splice(i,1);
  }

  // update collectibles & popups
  updateCollectibles(delta, timestamp);
  updatePopups(delta);

  // collision with pipes (skip invincible)
  if (!invincible) {
    for (const p of pipes) {
      const left = p.x, right = p.x + PIPE_WIDTH;
      let topY, bottomY;
      if (p.fromBottom) { bottomY = canvas.height - BRICK_HEIGHT; topY = bottomY - p.height; }
      else { topY = BRICK_HEIGHT; bottomY = topY + p.height; }
      if (bird.x + BIRD_RADIUS > left && bird.x - BIRD_RADIUS < right) {
        if (bird.y + BIRD_RADIUS > topY && bird.y - BIRD_RADIUS < bottomY) {
          triggerGameOver(); return;
        }
      }
    }
  }
}

/* -------------------------
   Skin unlock logic
   ------------------------- */
function checkSkinUnlocks() {
  for (const skin of SKINS) {
    if (skin.unlockScore > 0 && !isSkinUnlocked(skin.id) && score >= skin.unlockScore) {
      unlockSkin(skin.id);
    }
  }
}

/* -------------------------
   Draw functions
   ------------------------- */
function drawBackground() {
  if (imgReady(bgImg)) ctx.drawImage(bgImg,0,0,canvas.width,canvas.height);
  else { ctx.fillStyle="#000"; ctx.fillRect(0,0,canvas.width,canvas.height); }
}
function drawBricks() {
  if (imgReady(brickImg)) {
    const naturalW = brickImg.naturalWidth, naturalH = brickImg.naturalHeight;
    const maxAllowedH = Math.floor(canvas.height * 0.45);
    const targetH = Math.min(DESIRED_BRICK_H, maxAllowedH);
    const scale = targetH / naturalH;
    const drawW = Math.round(naturalW * scale);
    const drawH = Math.round(naturalH * scale);
    BRICK_HEIGHT = drawH;
    for (let x=0; x<canvas.width + drawW; x+=drawW) {
      ctx.drawImage(brickImg, x, 0, drawW, drawH);
      ctx.drawImage(brickImg, x, canvas.height - drawH, drawW, drawH);
    }
  } else {
    ctx.fillStyle="#b22222";
    ctx.fillRect(0,0,canvas.width,BRICK_HEIGHT);
    ctx.fillRect(0,canvas.height-BRICK_HEIGHT,canvas.width,BRICK_HEIGHT);
  }
}
function drawPipes() {
  for (const p of pipes) {
    const x = p.x, h = p.height;
    const y = p.fromBottom ? (canvas.height - BRICK_HEIGHT - h) : BRICK_HEIGHT;
    if (imgReady(personImg)) ctx.drawImage(personImg, x, y, PIPE_WIDTH, h);
    else { ctx.fillStyle = "green"; ctx.fillRect(x,y,PIPE_WIDTH,h); }
  }
}
function drawCollectibles() {
  for (const it of collectibles) {
    const img = itemImages[it.typeId];
    if (imgReady(img)) ctx.drawImage(img, it.x, it.y - it.size/2, it.size, it.size);
    else { ctx.fillStyle = "#ffcc00"; ctx.beginPath(); ctx.arc(it.x + it.size/2, it.y, it.size/2, 0, Math.PI*2); ctx.fill(); }
  }
}

/* ---------- drawBird: preserve aspect ratio and center ---------- */
function drawBird() {
  if (imgReady(birdImg)) {
    const drawDiameter = BIRD_RADIUS * 2;
    const iw = birdImg.naturalWidth || 1;
    const ih = birdImg.naturalHeight || 1;
    const aspect = iw / ih;
    let dw, dh;
    if (aspect >= 1) {
      dw = drawDiameter;
      dh = Math.round(drawDiameter / aspect);
    } else {
      dh = drawDiameter;
      dw = Math.round(drawDiameter * aspect);
    }
    const dx = Math.round(bird.x - dw / 2);
    const dy = Math.round(bird.y - dh / 2);
    ctx.save();
    ctx.beginPath();
    ctx.arc(bird.x, bird.y, BIRD_RADIUS, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(birdImg, dx, dy, dw, dh);
    ctx.restore();
  } else {
    ctx.fillStyle = "yellow";
    ctx.beginPath();
    ctx.arc(bird.x, bird.y, BIRD_RADIUS, 0, Math.PI*2);
    ctx.fill();
  }
}
// ----------------------------------------------------------------

function drawPopups() { for (const p of popups) { const alpha = 1 - p.t / p.life; ctx.save(); ctx.globalAlpha = Math.max(0, alpha); ctx.font = "20px Arial"; ctx.textAlign = "center"; ctx.fillStyle = "#fff9b0"; ctx.fillText(p.text, p.x, p.y); ctx.restore(); } }
function drawHUD() {
  ctx.fillStyle = "white"; ctx.font = "24px Arial"; ctx.textAlign = "left";
  ctx.fillText("Score: " + score, 10, 40);
  ctx.textAlign = "right";
  ctx.fillText("Best: " + highScore, canvas.width - 10, 40);
}
function draw() {
  ctx.clearRect(0,0,canvas.width,canvas.height);
  drawBackground(); drawBricks(); drawPipes(); drawCollectibles(); drawBird(); drawPopups(); drawHUD();
  if (!isStarted) {
    ctx.fillStyle = "rgba(0,0,0,0.25)"; ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.font = "22px Arial"; ctx.textAlign = "center";
    if (isGameOver && score > 0) { ctx.fillStyle = "white"; ctx.fillText("GAME OVER", canvas.width/2, canvas.height/2 - 20); ctx.fillText("Score: " + score, canvas.width/2, canvas.height/2 + 10); }
    else { ctx.fillStyle = "white"; ctx.fillText("Tap to Start", canvas.width/2, canvas.height/2 + 60); }
  }
}

/* -------------------------
   Game over & high score
   ------------------------- */
function checkAndUpdateHighScore() {
  if (score > highScore) {
    highScore = score; saveHighScore(highScore); updateStartHighScoreUI();
    spawnPopup(canvas.width/2, canvas.height/2 - 30, "NEW BEST!");
    try { if (hitSound && !audioMuted) { hitSound.currentTime = 0; hitSound.play().catch(()=>{}); } } catch(e){} 
  }
}
function triggerGameOver() {
  isGameOver = true; isStarted = false;
  if (music && !audioMuted) try { music.pause(); } catch(e){}
  if (hitSound && !audioMuted) { try { hitSound.currentTime = 0; hitSound.play().catch(()=>{}); } catch(e){} }
  checkAndUpdateHighScore();
  showGameOverScreen();
}

/* -------------------------
   Main loop
   ------------------------- */
let lastTime = performance.now();
function loop(time) {
  const delta = time - lastTime; lastTime = time;
  update(delta, time);
  draw();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

/* -------------------------
   Initialization
   ------------------------- */
setAllAudioMuted(false);
updateMuteUI();
updateStartHighScoreUI();
showStartScreen();
renderSkinsGrid();
