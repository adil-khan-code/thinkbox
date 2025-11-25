const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');

app.use(express.static(path.join(__dirname, 'public')));

const rooms = {};
const NEXT_ROUND_DELAY = 5000; // 5 seconds to read the complex result

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
            room.gameInProgress = true;
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
        r.gameActive = false;

        const allDice = r.players.flatMap(p => p.dice);
        const targetFace = r.currentBid.face;
        const count = allDice.filter(d => d === targetFace || d === 1).length;
        const bidWasTrue = count >= r.currentBid.quantity;
        
        let safePlayerId;
        let roundLosers = [];
        let message;
        let nextTurnPlayerIndex;

        const challengerIndex = r.currentTurnIndex;
        const bidderIndex = r.players.findIndex(p => p.id === r.currentBid.player);
        const challenger = r.players[challengerIndex];
        const bidder = r.players[bidderIndex];

        if (bidWasTrue) {
            // The bid was TRUE. The challenger was WRONG.
            // The challenger is the only one who doesn't lose a die.
            safePlayerId = challenger.id;
            nextTurnPlayerIndex = challengerIndex;
            message = `${bidder.username}'s bid was TRUE! Everyone except ${challenger.username} loses a die!`;
        } else {
            // The bid was FALSE. The challenger was RIGHT.
            // The bidder (the liar) is the only one who doesn't lose a die.
            safePlayerId = bidder.id;
            nextTurnPlayerIndex = bidderIndex;
            message = `${bidder.username} was LYING! Everyone except ${bidder.username} loses a die!`;
        }

        // Apply penalty to everyone except the safe player
        r.players.forEach(p => {
            if (p.id !== safePlayerId && p.diceCount > 0) {
                p.diceCount--;
                roundLosers.push(p); // Track players who lost a die
            }
        });

        io.to(roomName).emit('roundOver', {
            allPlayers: r.players,
            message: message
        });

        // Check for a winner from the list of players who just lost a die
        let winner = null;
        for (const p of roundLosers) {
            if (p.diceCount === 0) {
                winner = p;
                break; // We have a winner!
            }
        }
        
        if (winner) {
            // Game Over
            io.to(roomName).emit('gameOver', { winner: winner.username });
            resetRoom(r);
            setTimeout(() => io.to(roomName).emit('roomUpdate', r), NEXT_ROUND_DELAY);
        } else {
            // Not over, start next round
            r.currentTurnIndex = nextTurnPlayerIndex;
            setTimeout(() => startGameLogic(r, roomName), NEXT_ROUND_DELAY);
        }
    });

    socket.on('disconnect', () => { /* Add cleanup logic if needed */ });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`Server running on port ${PORT}`));
