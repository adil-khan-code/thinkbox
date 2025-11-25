const socket = io();
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

let gameState = null;
let myId = null;
let myUsername = "";
let myRoom = "";

// Local selection state for UI
let localQty = 1;
let localFace = 2; 

// --- CONNECTION ---

socket.on('connect', () => {
    myId = socket.id;
});

socket.on('roomUpdate', (room) => {
    gameState = room;
    updateUI();
    drawGame();
});

socket.on('gameStarted', (room) => {
    gameState = room;
    notify("Game Started!");
    updateUI();
    drawGame();
});

socket.on('roundOver', (data) => {
    gameState.players = data.allPlayers; // Reveal dice
    gameState.gameActive = false;
    gameState.currentBid = null;
    notify(data.message);
    updateUI();
    drawGame();
});

socket.on('notification', (msg) => {
    notify(msg);
});

// --- ACTIONS ---

function joinGame() {
    myUsername = document.getElementById('username').value;
    myRoom = document.getElementById('roomName').value;
    if(!myUsername || !myRoom) return alert("Please fill in both fields");

    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('game-container').classList.remove('hidden');
    document.getElementById('dispRoom').innerText = myRoom;

    socket.emit('joinRoom', { username: myUsername, room: myRoom });
}

function toggleReady() {
    socket.emit('playerReady', myRoom);
    // Button visual update happens via roomUpdate event
}

function submitBid() {
    socket.emit('placeBid', { room: myRoom, quantity: localQty, face: localFace });
}

function callLiar() {
    socket.emit('callLiar', myRoom);
}

// --- UI LOGIC ---

function notify(msg) {
    const el = document.getElementById('notification-area');
    el.innerText = msg;
    setTimeout(() => { el.innerText = ""; }, 5000);
}

function initBidControls() {
    const selector = document.getElementById('dice-selector');
    selector.innerHTML = '';
    
    // Faces 2-6
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
    localQty += delta;
    if (localQty < 1) localQty = 1;
    
    if (gameState && gameState.currentBid) {
        if (localQty < gameState.currentBid.quantity) {
            localQty = gameState.currentBid.quantity;
        }
    }
    validateSelection(); 
    updateBidVisuals();
}

function selectFace(face) {
    if (isValidBid(localQty, face)) {
        localFace = face;
        updateBidVisuals();
    }
}

function isValidBid(q, f) {
    if (!gameState.currentBid) return true;
    if (q > gameState.currentBid.quantity) return true;
    if (q === gameState.currentBid.quantity && f > gameState.currentBid.face) return true;
    return false;
}

function validateSelection() {
    if (!isValidBid(localQty, localFace)) {
        for(let f=2; f<=6; f++) {
            if(isValidBid(localQty, f)) {
                localFace = f;
                break;
            }
        }
    }
}

function resetBidSelection() {
    if (!gameState.currentBid) {
        localQty = 1;
        localFace = 2;
    } else {
        if (gameState.currentBid.face < 6) {
            localQty = gameState.currentBid.quantity;
            localFace = gameState.currentBid.face + 1;
        } else {
            localQty = gameState.currentBid.quantity + 1;
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

    const btn = document.getElementById('btn-place-bid');
    if(btn) btn.innerText = `Bid ${localQty} x ${localFace}s`;
}

// Call once
initBidControls();

function updateUI() {
    if (!gameState) return;

    const readyArea = document.getElementById('ready-area');
    const controls = document.getElementById('controls-area');
    const liarBtn = document.getElementById('btnLiar');
    const turnBar = document.getElementById('turn-bar');
    const readyBtn = document.getElementById('btn-ready');
    const readyStatusText = document.getElementById('ready-status-text');

    // 1. GAME NOT ACTIVE (Lobby Mode)
    if (!gameState.gameActive) {
        controls.classList.add('hidden');
        readyArea.classList.remove('hidden');

        // Update Turn Bar
        turnBar.innerText = "Lobby Phase";
        turnBar.className = "turn-waiting";

        // Count Ready Players
        const readyCount = gameState.players.filter(p => p.isReady).length;
        const totalCount = gameState.players.length;
        readyStatusText.innerText = `${readyCount} / ${totalCount} Players Ready`;

        // Check if I am ready
        const myPlayer = gameState.players.find(p => p.id === myId);
        if (myPlayer && myPlayer.isReady) {
            readyBtn.innerText = "Waiting for others...";
            readyBtn.disabled = true;
            readyBtn.style.background = "#8e8e93";
        } else {
            readyBtn.innerText = "I'M READY";
            readyBtn.disabled = false;
            readyBtn.style.background = "#34c759";
        }

    } else {
        // 2. GAME ACTIVE
        readyArea.classList.add('hidden');

        const activePlayer = gameState.players[gameState.currentTurnIndex];
        const isMyTurn = (activePlayer.id === myId);

        if (isMyTurn) {
            controls.classList.remove('hidden');
            
            // Only reset logical defaults if selection is currently invalid
            if (!isValidBid(localQty, localFace)) {
                resetBidSelection();
            } else {
                updateBidVisuals();
            }

            liarBtn.disabled = !gameState.currentBid;
            turnBar.innerText = "IT'S YOUR TURN!";
            turnBar.className = "turn-mine";
        } else {
            controls.classList.add('hidden');
            turnBar.innerText = `Waiting for ${activePlayer.username}...`;
            turnBar.className = "turn-others";
        }
    }
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
    if (gameState.currentBid) {
        ctx.fillStyle = "#f1c40f";
        ctx.font = "bold 40px Arial";
        ctx.fillText(`${gameState.currentBid.quantity} x `, cx - 25, cy);
        drawDieFace(cx + 30, cy - 20, 40, gameState.currentBid.face);
        ctx.font = "16px Arial";
        ctx.fillStyle = "#ddd";
        ctx.fillText(`(Current Bid)`, cx, cy + 40);
    } else {
        // Show something in center if game waiting
        if (!gameState.gameActive) {
            ctx.fillStyle = "rgba(255,255,255,0.5)";
            ctx.font = "italic 20px Arial";
            ctx.fillText("Waiting for players...", cx, cy);
        } else {
            ctx.fillStyle = "white";
            ctx.font = "20px Arial";
            ctx.fillText("Waiting for first bid...", cx, cy);
        }
    }

    // Players
    const totalPlayers = gameState.players.length;
    gameState.players.forEach((player, i) => {
        const angle = (Math.PI * 2 / totalPlayers) * i;
        const px = cx + Math.cos(angle) * tableRadius;
        const py = cy + Math.sin(angle) * tableRadius;
        drawPlayer(player, px, py, i === gameState.currentTurnIndex);
    });
}

function drawPlayer(player, x, y, isTurn) {
    // 1. Active Glow
    if (isTurn && gameState.gameActive) {
        ctx.beginPath();
        ctx.arc(x, y, 45, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(241, 196, 15, 0.3)";
        ctx.fill();
        ctx.lineWidth = 4;
        ctx.strokeStyle = "#f1c40f";
        ctx.stroke();
    }

    // 2. Avatar Circle
    ctx.beginPath();
    ctx.arc(x, y, 30, 0, Math.PI * 2);
    ctx.fillStyle = (player.id === myId) ? "#0a84ff" : "#444";
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#fff";
    ctx.stroke();

    // 3. Name
    ctx.fillStyle = "white";
    ctx.font = isTurn ? "bold 18px Arial" : "16px Arial";
    ctx.textAlign = "center";
    ctx.fillText(player.username, x, y + 55);

    // 4. "Thinking..." Status
    if (isTurn && gameState.gameActive) {
        ctx.fillStyle = "#f1c40f";
        ctx.font = "bold 12px Arial";
        ctx.fillText("THINKING...", x, y - 40);
    }

    // 5. READY CHECKMARK (If game not active)
    if (!gameState.gameActive && player.isReady) {
        // Draw green circle
        ctx.beginPath();
        ctx.arc(x + 25, y - 25, 12, 0, Math.PI*2);
        ctx.fillStyle = "#34c759";
        ctx.fill();
        ctx.strokeStyle = "white";
        ctx.lineWidth = 2;
        ctx.stroke();
        
        // Draw check
        ctx.fillStyle = "white";
        ctx.font = "bold 16px Arial";
        ctx.fillText("✓", x + 25, y - 19);
    }

    // 6. Dice
    const showValues = (player.id === myId) || (!gameState.gameActive);
    const diceSize = 25;
    const gap = 5;
    const totalWidth = (player.diceCount * diceSize) + ((player.diceCount-1) * gap);
    let startX = x - (totalWidth / 2);
    let startY = y + 65;

    if (player.diceCount > 0) {
        // If game is idle, we might not have rolled yet, handle gracefully
        const diceToDraw = player.dice.length > 0 ? player.dice : new Array(player.diceCount).fill(0);

        for(let i=0; i<player.diceCount; i++) {
            let val = 0; 
            if (showValues && diceToDraw[i]) val = diceToDraw[i];
            drawDieFace(startX + (i * (diceSize + gap)), startY, diceSize, val);
        }
    } else {
        ctx.fillStyle = "#ff3b30";
        ctx.font = "12px Arial";
        ctx.fillText("ELIMINATED", x, startY + 15);
    }
}

function drawDieFace(x, y, size, val) {
    ctx.fillStyle = (val === 0) ? "#8e8e93" : "white";
    ctx.strokeStyle = "#333";
    ctx.lineWidth = 1;

    ctx.beginPath();
    if (ctx.roundRect) {
        ctx.roundRect(x, y, size, size, 4);
    } else {
        ctx.rect(x, y, size, size);
    }
    ctx.fill();
    ctx.stroke();

    if (val === 0) {
        ctx.fillStyle = "#d1d1d6";
        ctx.font = `bold ${size/1.5}px Arial`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("?", x + size/2, y + size/2 + 2);
        return;
    }

    ctx.fillStyle = "black";
    const dotSize = size / 5;
    const c = size / 2; 
    const q = size / 4; 

    const dot = (dx, dy) => {
        ctx.beginPath();
        ctx.arc(x + dx, y + dy, dotSize/2, 0, Math.PI*2);
        ctx.fill();
    };

    if (val % 2 === 1) dot(c, c);
    if (val > 1) { dot(q, q); dot(size-q, size-q); }
    if (val > 3) { dot(size-q, q); dot(q, size-q); }
    if (val === 6) { dot(q, c); dot(size-q, c); }
}
