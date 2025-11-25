const socket = io();
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

let gameState = null;
let myId = null;
let myUsername = "";
let myRoom = "";

// --- Socket Events ---

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
    // Reveal dice
    gameState.players = data.allPlayers; 
    gameState.gameActive = false;
    gameState.currentBid = null;
    
    notify(data.message);
    updateUI();
    drawGame();
});

socket.on('notification', (msg) => {
    notify(msg);
});

// --- UI Logic ---

function joinGame() {
    myUsername = document.getElementById('username').value;
    myRoom = document.getElementById('roomName').value;
    
    if(!myUsername || !myRoom) {
        alert("Please enter a nickname and a room name.");
        return;
    }

    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('game-container').classList.remove('hidden');
    document.getElementById('dispRoom').innerText = myRoom;

    socket.emit('joinRoom', { username: myUsername, room: myRoom });
}

function startGame() {
    socket.emit('startGame', myRoom);
}

function placeBid() {
    const qty = parseInt(document.getElementById('bidQty').value);
    const face = parseInt(document.getElementById('bidFace').value);
    socket.emit('placeBid', { room: myRoom, quantity: qty, face: face });
}

function callLiar() {
    socket.emit('callLiar', myRoom);
}

function notify(msg) {
    const el = document.getElementById('notification-area');
    el.innerText = msg;
    // Clear message after 5 seconds
    setTimeout(() => { el.innerText = ""; }, 5000);
}

function updateUI() {
    if (!gameState) return;

    const startBtn = document.getElementById('start-btn');
    const controls = document.getElementById('controls-area');
    const liarBtn = document.getElementById('btnLiar');
    const turnBar = document.getElementById('turn-bar');

    if (!gameState.gameActive) {
        // Game Not Running
        startBtn.classList.remove('hidden');
        controls.classList.add('hidden');
        turnBar.innerText = "Waiting for start...";
        turnBar.className = "turn-waiting";
    } else {
        // Game Running
        startBtn.classList.add('hidden');
        
        const activePlayer = gameState.players[gameState.currentTurnIndex];
        const isMyTurn = (activePlayer.id === myId);

        if (isMyTurn) {
            controls.classList.remove('hidden');
            liarBtn.disabled = !gameState.currentBid; // Can't call liar on very first move
            
            // UPDATE TEXT BAR FOR ME
            turnBar.innerText = "IT'S YOUR TURN!";
            turnBar.className = "turn-mine";
        } else {
            controls.classList.add('hidden');
            
            // UPDATE TEXT BAR FOR OTHERS
            turnBar.innerText = `Waiting for ${activePlayer.username}...`;
            turnBar.className = "turn-others";
        }
    }
}

// --- CANVAS DRAWING LOGIC ---

function drawGame() {
    // 1. Clear Screen
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (!gameState) return;

    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const tableRadius = 220;

    // 2. Draw Table Center Info
    ctx.textAlign = "center";
    if (gameState.currentBid) {
        ctx.fillStyle = "#f1c40f";
        ctx.font = "bold 40px Arial";
        ctx.fillText(`${gameState.currentBid.quantity} x `, cx - 25, cy);
        drawDieFace(cx + 30, cy - 20, 40, gameState.currentBid.face);
        
        ctx.font = "16px Arial";
        ctx.fillStyle = "#ddd";
        ctx.fillText(`(Current Bid)`, cx, cy + 40);
    } else if (gameState.gameActive) {
        ctx.fillStyle = "white";
        ctx.font = "20px Arial";
        ctx.fillText("Waiting for first bid...", cx, cy);
    }

    // 3. Draw Players
    const totalPlayers = gameState.players.length;
    
    gameState.players.forEach((player, i) => {
        const angle = (Math.PI * 2 / totalPlayers) * i;
        const px = cx + Math.cos(angle) * tableRadius;
        const py = cy + Math.sin(angle) * tableRadius;

        drawPlayer(player, px, py, i === gameState.currentTurnIndex);
    });
}

function drawPlayer(player, x, y, isTurn) {
    // Draw Active Player Glow
    if (isTurn && gameState.gameActive) {
        ctx.beginPath();
        ctx.arc(x, y, 45, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(241, 196, 15, 0.3)";
        ctx.fill();
        ctx.lineWidth = 4;
        ctx.strokeStyle = "#f1c40f";
        ctx.stroke();
    }

    // Avatar Circle
    ctx.beginPath();
    ctx.arc(x, y, 30, 0, Math.PI * 2);
    ctx.fillStyle = (player.id === myId) ? "#2980b9" : "#444";
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#fff";
    ctx.stroke();
    ctx.closePath();

    // Name
    ctx.fillStyle = "white";
    ctx.font = isTurn ? "bold 18px Arial" : "16px Arial";
    ctx.textAlign = "center";
    ctx.fillText(player.username, x, y + 55);

    // Thinking Text
    if (isTurn && gameState.gameActive) {
        ctx.fillStyle = "#f1c40f";
        ctx.font = "bold 12px Arial";
        ctx.fillText("THINKING...", x, y - 40);
    }

    // Dice Container
    const showValues = (player.id === myId) || (!gameState.gameActive);
    const diceSize = 25;
    const gap = 5;
    const totalWidth = (player.diceCount * diceSize) + ((player.diceCount-1) * gap);
    let startX = x - (totalWidth / 2);
    let startY = y + 65;

    if (player.diceCount > 0) {
        for(let i=0; i<player.diceCount; i++) {
            let val = 0; 
            if (showValues && player.dice[i]) {
                val = player.dice[i];
            }
            drawDieFace(startX + (i * (diceSize + gap)), startY, diceSize, val);
        }
    } else {
        ctx.fillStyle = "#e74c3c";
        ctx.font = "12px Arial";
        ctx.fillText("ELIMINATED", x, startY + 15);
    }
}

function drawDieFace(x, y, size, val) {
    ctx.fillStyle = (val === 0) ? "#95a5a6" : "white";
    ctx.strokeStyle = "#333";
    ctx.lineWidth = 1;

    // Draw Rounded Square (manual fallback)
    ctx.beginPath();
    if (ctx.roundRect) {
        ctx.roundRect(x, y, size, size, 4);
    } else {
        ctx.rect(x, y, size, size); // Old browser fallback
    }
    ctx.fill();
    ctx.stroke();

    // Draw Question Mark if hidden
    if (val === 0) {
        ctx.fillStyle = "#bdc3c7";
        ctx.font = `bold ${size/1.5}px Arial`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("?", x + size/2, y + size/2 + 2);
        return;
    }

    // Draw Pips (Dots)
    ctx.fillStyle = "black";
    const dotSize = size / 5;
    const c = size / 2; // center
    const q = size / 4; // quarter

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
