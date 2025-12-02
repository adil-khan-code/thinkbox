const socket = io();
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

let gameState = null;
let myId = null;
let myUsername = "";
let myRoom = "";
let myRole = "player"; // NEW: player or spectator

let localQty = 1;
let localFace = 2;

// --- SOCKET LISTENERS ---
socket.on('connect', () => { myId = socket.id; });
socket.on('roomUpdate', (room) => { gameState = room; updateUI(); drawGame(); });
socket.on('gameStarted', (room) => { gameState = room; notify(""); updateUI(); drawGame(); });
socket.on('roundOver', (data) => {
    gameState.players = data.allPlayers; 
    gameState.gameActive = false;
    gameState.currentBid = null;
    notify(data.message);
    updateUI();
    drawGame();
});
socket.on('gameOver', (data) => {
    document.getElementById('winner-text').innerText = `${data.loser} is the loser!`;
    document.getElementById('game-over-overlay').classList.remove('hidden');
});
socket.on('notification', (msg) => { notify(msg); });

// --- USER ACTIONS ---
function joinGame() {
    myUsername = document.getElementById('username').value.trim();
    myRoom = document.getElementById('roomName').value.trim();
    myRole = document.querySelector('input[name="role"]:checked').value; // NEW

    if(!myUsername || !myRoom) return alert("Please fill in both fields");

    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('game-container').classList.remove('hidden');
    document.getElementById('dispRoom').innerText = myRoom;

    socket.emit('joinRoom', { username: myUsername, room: myRoom, role: myRole });

    setupUIForRole(myRole);
}

function setupUIForRole(role) {
    if (role === 'spectator') {
        document.getElementById('ready-area').classList.add('hidden');
        document.getElementById('controls-area').classList.add('hidden');
        document.getElementById('turn-bar').innerText = "You are watching as a spectator";
    } else {
        document.getElementById('ready-area').classList.remove('hidden');
        document.getElementById('controls-area').classList.remove('hidden');
        document.getElementById('turn-bar').innerText = "Waiting for your turn...";
    }
}

function closeGameOver() {
    document.getElementById('game-over-overlay').classList.add('hidden');
}

function toggleReady() { 
    if(myRole === 'player') socket.emit('playerReady', myRoom); 
}

function submitBid() { 
    if(myRole === 'player') socket.emit('placeBid', { room: myRoom, quantity: localQty, face: localFace }); 
}

function callLiar() { 
    if(myRole === 'player') socket.emit('callLiar', myRoom); 
}

// --- UI HELPERS ---
function notify(msg) {
    const el = document.getElementById('notification-area');
    el.innerText = msg;
    if(msg) setTimeout(() => { el.innerText = ""; }, 3800);
}

function initBidControls() {
    const selector = document.getElementById('dice-selector');
    selector.innerHTML = '';
    for(let i=2; i<=6; i++) {
        const btn = document.createElement('div');
        btn.className = 'select-die';
        btn.onclick = () => selectFace(i);
        btn.id = `die-btn-${i}`;
        btn.innerHTML = `<span style="font-size:18px; font-weight:bold;">${i}</span>`;
        selector.appendChild(btn);
    }
}

function adjustQty(delta) {
    if (!gameState) return;
    const totalDiceInPlay = gameState.players.reduce((sum, p) => sum + p.diceCount, 0);
    let newQty = localQty + delta;
    if (newQty > totalDiceInPlay) newQty = totalDiceInPlay;
    if (newQty < 1) newQty = 1;
    if (gameState.currentBid && newQty < gameState.currentBid.quantity) newQty = gameState.currentBid.quantity;
    localQty = newQty;
    validateSelection(); 
    updateBidVisuals();
}

function selectFace(face) { if (isValidBid(localQty, face)) { localFace = face; updateBidVisuals(); } }
function isValidBid(q, f) {
    if (!gameState.currentBid) return true;
    if (q > gameState.currentBid.quantity) return true;
    if (q === gameState.currentBid.quantity && f > gameState.currentBid.face) return true;
    return false;
}

function validateSelection() {
    if (!isValidBid(localQty, localFace)) {
        for(let f=2; f<=6; f++) { if(isValidBid(localQty, f)) { localFace = f; break; } }
    }
}

function resetBidSelection() {
    if (!gameState.currentBid) { localQty = 1; localFace = 2; }
    else {
        if (gameState.currentBid.face < 6) {
            localQty = gameState.currentBid.quantity;
            localFace = gameState.currentBid.face + 1;
        } else {
            const totalDiceInPlay = gameState.players.reduce((sum, p) => sum + p.diceCount, 0);
            localQty = (gameState.currentBid.quantity < totalDiceInPlay) ? gameState.currentBid.quantity + 1 : gameState.currentBid.quantity;
            localFace = 2;
        }
    }
    updateBidVisuals();
}

function updateBidVisuals() {
    document.getElementById('displayQty').innerText = localQty;
    for(let i=2; i<=6; i++) {
        const btn = document.getElementById(`die-btn-${i}`);
        if(btn) {
            btn.className = 'select-die';
            if (!isValidBid(localQty, i)) btn.classList.add('disabled');
            if (i === localFace) btn.classList.add('selected');
        }
    }
    document.getElementById('btn-place-bid').innerText = `Bid ${localQty} × ${localFace}s`;
}

initBidControls();

// --- MAIN UI CONTROLLER ---
function updateUI() {
    if (!gameState) return;
    const readyArea = document.getElementById('ready-area');
    const controls = document.getElementById('controls-area');
    const liarBtn = document.getElementById('btn-liar');
    const turnBar = document.getElementById('turn-bar');

    // Update spectators display
    const spectatorsList = (gameState.spectators || []).map(s => s.username).join(', ') || 'None';
    document.getElementById('spectators-display').innerText = `Audience: ${spectatorsList}`;

    // If spectator, hide all interactive elements
    if(myRole === 'spectator') {
        readyArea.classList.add('hidden');
        controls.classList.add('hidden');
        turnBar.innerText = "Watching as spectator";
        return;
    }

    // LOBBY PHASE
    if (!gameState.gameInProgress) {
        controls.classList.add('hidden');
        readyArea.classList.remove('hidden');
        turnBar.innerText = "Lobby";
        turnBar.className = "turn-waiting";
        const readyCount = gameState.players.filter(p => p.isReady).length;
        document.getElementById('ready-status-text').innerText = `${readyCount} / ${gameState.players.length} Players Ready`;
        const myPlayer = gameState.players.find(p => p.id === myId);
        const readyBtn = document.getElementById('btn-ready');
        readyBtn.disabled = myPlayer && myPlayer.isReady;
        readyBtn.innerText = (myPlayer && myPlayer.isReady) ? "Waiting for Others..." : "I'M READY";
    } else { // GAME IN PROGRESS
        readyArea.classList.add('hidden');
        const activePlayer = gameState.players[gameState.currentTurnIndex];
        const isMyTurn = gameState.gameActive && (activePlayer.id === myId);

        if (isMyTurn) {
            controls.classList.remove('hidden');
            renderCurrentBidInPanel();
            renderHandInPanel(gameState.players.find(p => p.id === myId));
            if (!isValidBid(localQty, localFace)) resetBidSelection();
            else updateBidVisuals();
            liarBtn.disabled = !gameState.currentBid;
            turnBar.innerText = "IT'S YOUR TURN!";
            turnBar.className = "turn-mine";
        } else {
            controls.classList.add('hidden');
            if (!gameState.gameActive) {
                turnBar.innerText = "Revealing Dice...";
                turnBar.className = "turn-waiting";
            } else {
                turnBar.innerText = `Waiting for ${activePlayer.username}...`;
                turnBar.className = "turn-others";
            }
        }
    }
}

// --- Existing rendering functions remain unchanged ---
// renderCurrentBidInPanel(), renderHandInPanel(), drawGame(), drawPlayer(), drawDieFace()

