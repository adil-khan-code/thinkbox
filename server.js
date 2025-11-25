const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');

app.use(express.static(path.join(__dirname, 'public')));

const rooms = {};
const NEXT_ROUND_DELAY = 4000; // 4 seconds

function resetRoom(room) {
    room.gameInProgress = false;
    room.gameActive = false;
    room.currentBid = null;
    room.players.forEach(p => {
        p.diceCount = 5; // Reset dice for a new game
        p.isReady = false;
        p.dice = [];
    });
}

io.on('connection', (socket) => {
    socket.on('joinRoom', ({ username, room }) => {
        socket.join(room);
        if (!rooms[room]) {
            rooms[room] = { players: [], currentTurnIndex: 0, currentBid: null, gameActive: false, gameInProgress: false };
        }
        const newPlayer = { id: socket.id, username, dice: [], diceCount: 5, isReady: false };
        rooms[room].players.push(newPlayer);
        io.to(room).emit('roomUpdate', rooms[room]);
    });

    socket.on('playerReady', (roomName) => {
        const room = rooms[roomName];
        if (!room) return;
        const player = room.players.find(p => p.id === socket.id);
        if (player) player.isReady = true;

        const allReady = room.players.every(p => p.isReady);
        if (room.players.length > 1 && allReady) {
            room.gameInProgress = true; // The match has officially started
            startGameLogic(room, roomName);
        } else {
            io.to(roomName).emit('roomUpdate', room);
        }
    });

    function startGameLogic(room, roomName) {
        room.gameActive = true;
        room.currentBid = null;
        room.players.forEach(p => {
            p.dice = [];
            if(p.diceCount > 0) {
                for(let i=0; i < p.diceCount; i++) {
                    p.dice.push(Math.ceil(Math.random() * 6));
                }
                p.dice.sort((a,b) => a-b);
            }
        });
        // Ensure starting player has dice
        if (room.players[room.currentTurnIndex].diceCount === 0) {
             do {
                room.currentTurnIndex = (room.currentTurnIndex + 1) % room.players.length;
            } while (room.players[room.currentTurnIndex].diceCount === 0);
        }
        io.to(roomName).emit('gameStarted', room);
    }

    socket.on('placeBid', ({ room, quantity, face }) => {
        const r = rooms[room];
        if (!r || !r.gameActive) return;
        if (r.currentBid && (quantity < r.currentBid.quantity || (quantity === r.currentBid.quantity && face <= r.currentBid.face))) return;
        r.currentBid = { quantity, face, player: socket.id };
        do {
            r.currentTurnIndex = (r.currentTurnIndex + 1) % r.players.length;
        } while (r.players[r.currentTurnIndex].diceCount === 0);
        io.to(room).emit('roomUpdate', r);
    });

    socket.on('callLiar', (roomName) => {
        const r = rooms[roomName];
        if (!r || !r.currentBid) return;
        r.gameActive = false; // Stop bids during reveal

        const allDice = r.players.flatMap(p => p.dice);
        const targetFace = r.currentBid.face;
        const count = allDice.filter(d => d === targetFace || d === 1).length;
        const bidWasTrue = count >= r.currentBid.quantity;
        
        const winnerIndex = bidWasTrue ? r.players.findIndex(p => p.id === r.currentBid.player) : r.currentTurnIndex;
        const loser = r.players[winnerIndex]; // The winner of the challenge loses a die
        if (loser) loser.diceCount--;

        io.to(roomName).emit('roundOver', {
            allPlayers: r.players,
            message: `There were ${count} × ${targetFace}s. ${loser.username} loses a die!`
        });
        
        // Check for Game Over condition
        const playersWithDice = r.players.filter(p => p.diceCount > 0);
        if (playersWithDice.length <= 1) {
            const winner = playersWithDice[0];
            io.to(roomName).emit('gameOver', { winner: winner ? winner.username : "Nobody" });
            resetRoom(r);
            setTimeout(() => io.to(roomName).emit('roomUpdate', r), NEXT_ROUND_DELAY);
        } else {
            // Start next round automatically after a delay
            r.currentTurnIndex = winnerIndex;
            setTimeout(() => startGameLogic(r, roomName), NEXT_ROUND_DELAY);
        }
    });

    socket.on('disconnect', () => { /* Add cleanup logic if needed */ });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`Server running on port ${PORT}`));
