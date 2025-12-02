const socket = io();
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

let gameState = null;
let myId = null;
let myUsername = "";
let myRoom = "";

let localQty = 1;
let localFace = 2;

// --- SOCKET LISTENERS ---
socket.on('connect', () => { myId = socket.id; });
socket.on('roomUpdate', (room) => { gameState = room; updateUI(); drawGame(); });
socket.on('gameStarted', (room) => { gameState = room; notify(""); updateUI(); drawGame(); });
socket.on('roundOver', (data) => {
    gameState.players = data.allPlayers; 
    gameState.gameActive = false;
    gameState.currentBid = null; // Clear bid for canvas
    notify(data.message);
    updateUI();
    drawGame();
});
socket.on('gameOver', (username) => {
    document.getElementById('winner-text').innerText = `${username} is the loser!`;
    document.getElementById('game-over-overlay').classList.remove('hidden');
});
socket.on('notification', (msg) => { notify(msg); });

// --- USER ACTIONS ---
function joinGame() {
    myUsername = document.getElementById('username').value;
    myRoom = document.getElementById('roomName').value;
    if(!myUsername || !myRoom) return alert("Please fill in both fields");
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('game-container').classList.remove('hidden');
    document.getElementById('dispRoom').innerText = myRoom;
    socket.emit('joinRoom', { username: myUsername, room: myRoom });
}

function closeGameOver() {
    document.getElementById('game-over-overlay').classList.add('hidden');
    // The server will automatically send a roomUpdate to reset to the lobby
}

function toggleReady() { socket.emit('playerReady', myRoom); }
function submitBid() { socket.emit('placeBid', { room: myRoom, quantity: localQty, face: localFace }); }
function callLiar() { socket.emit('callLiar', myRoom); }

// --- UI HELPERS ---
function notify(msg) {
    const el = document.getElementById('notification-area');
    el.innerText = msg;
    if(msg) setTimeout(() => { el.innerText = ""; }, 6000); // Clear before next round starts
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

initBidControls(); // Call once on page load

// --- MAIN UI CONTROLLER ---
function updateUI() {
    if (!gameState) return;
    const readyArea = document.getElementById('ready-area');
    const controls = document.getElementById('controls-area');
    const liarBtn = document.getElementById('btnLiar');
    const turnBar = document.getElementById('turn-bar');
    
    // LOBBY PHASE (Game hasn't started at all yet)
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
    } else { // GAME IS IN PROGRESS
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

function renderCurrentBidInPanel() {
    const container = document.getElementById('current-bid-display');
    if (gameState.currentBid) {
        container.innerHTML = `<div class="label">Current Bid to Beat</div><div class="bid-value">${gameState.currentBid.quantity} × ${gameState.currentBid.face}s</div>`;
    } else {
        container.innerHTML = `<div class="label">First Bid of the Round</div><div class="bid-value"><span>You start the bidding!</span></div>`;
    }
}

function renderHandInPanel(player) {
    const container = document.getElementById('my-hand-display');
    if (!container || !player) return;
    container.innerHTML = '';
    player.dice.forEach(val => {
        const dieDiv = document.createElement('div');
        dieDiv.className = 'large-die';
        dieDiv.innerText = val;
        if (val === 1) dieDiv.style.color = "#ff3b30";
        container.appendChild(dieDiv);
    });
}

// --- CANVAS DRAWING ---
function drawGame() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!gameState) return;
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const tableRadius = 220;

    // Center Info
    ctx.textAlign = "center";
    if (gameState.gameInProgress && gameState.currentBid) {
        ctx.fillStyle = "#f1c40f";
        ctx.font = "bold 40px Arial";
        ctx.fillText(`${gameState.currentBid.quantity} × `, cx - 25, cy);
        drawDieFace(cx + 30, cy - 20, 40, gameState.currentBid.face);
    }

    // Players
    gameState.players.forEach((player, i) => {
        const angle = (Math.PI * 2 / gameState.players.length) * i;
        const px = cx + Math.cos(angle) * tableRadius;
        const py = cy + Math.sin(angle) * tableRadius;
        drawPlayer(player, px, py, i === gameState.currentTurnIndex);
    });
}

function drawPlayer(player, x, y, isTurn) {
    // Glow
    if (isTurn && gameState.gameActive) {
        ctx.beginPath();
        ctx.arc(x, y, 45, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(241, 196, 15, 0.3)";
        ctx.fill();
        ctx.strokeStyle = "#f1c40f"; ctx.lineWidth = 4; ctx.stroke();
    }

    // Avatar
    ctx.beginPath();
    ctx.arc(x, y, 30, 0, Math.PI * 2);
    ctx.fillStyle = (player.id === myId) ? "#0a84ff" : "#444";
    ctx.fill();
    ctx.strokeStyle = "#fff"; ctx.lineWidth = 2; ctx.stroke();

    // Name & Dice Count
    ctx.fillStyle = "white";
    ctx.font = "bold 16px Arial";
    ctx.fillText(player.username, x, y + 55);
    ctx.font = "14px Arial";
    ctx.fillText(`${player.diceCount} dice`, x, y + 75);

    // Ready Check
    if (!gameState.gameInProgress && player.isReady) {
        ctx.beginPath();
        ctx.arc(x + 25, y - 25, 12, 0, Math.PI*2);
        ctx.fillStyle = "#34c759"; ctx.fill();
        ctx.strokeStyle = "white"; ctx.lineWidth = 2; ctx.stroke();
        ctx.fillStyle = "white"; ctx.font = "bold 16px Arial";
        ctx.fillText("✓", x + 25, y - 19);
    }

    // Dice on table
    if (player.diceCount > 0 && gameState.gameInProgress) {
        const showValues = !gameState.gameActive || player.id === myId; // Show my own dice or everyone's when round is over
        const diceArr = player.dice.length > 0 ? player.dice : new Array(player.diceCount).fill(0);
        const diceSize = 25;
        const gap = 5;
        const totalWidth = (player.diceCount * diceSize) + ((player.diceCount-1) * gap);
        let startX = x - (totalWidth / 2);
        let startY = y - 60;

        for(let i=0; i<player.diceCount; i++) {
            drawDieFace(startX + (i * (diceSize + gap)), startY, diceSize, showValues ? diceArr[i] : 0);
        }
    } else if (player.diceCount <= 0 && gameState.gameInProgress) {
        ctx.fillStyle = "#ff3b30";
        ctx.font = "bold 12px Arial";
        ctx.fillText("WON", x, y);
    }
}

function drawDieFace(x, y, size, val) {
    ctx.fillStyle = (val === 0) ? "#8e8e93" : "white";
    ctx.strokeStyle = "#333";
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, size, size, 4);
    else ctx.rect(x, y, size, size);
    ctx.fill();
    ctx.stroke();

    if (val === 0) {
        ctx.fillStyle = "#d1d1d6";
        ctx.font = `bold ${size/1.5}px Arial`;
        ctx.textBaseline = "middle";
        ctx.fillText("?", x + size/2, y + size/2 + 2);
        return;
    }

    ctx.fillStyle = (val === 1) ? "#ff3b30" : "black";
    const dotSize = size / 5;
    const c = size / 2; 
    const q = size / 4; 
    const dot = (dx, dy) => { ctx.beginPath(); ctx.arc(x + dx, y + dy, dotSize/2, 0, Math.PI*2); ctx.fill(); };

    if (val % 2 === 1) dot(c, c);
    if (val > 1) { dot(q, q); dot(size-q, size-q); }
    if (val > 3) { dot(size-q, q); dot(q, size-q); }
    if (val === 6) { dot(q, c); dot(size-q, c); }
}
