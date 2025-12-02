const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');

app.use(express.static(path.join(__dirname, 'public')));

const rooms = {};
const NEXT_ROUND_DELAY = 7000; // 7 seconds to read the result

function resetRoom(room) {
    room.gameInProgress = false;
    room.gameActive = false;
    room.currentBid = null;
    room.currentTurnIndex = 0;
    room.players.forEach(p => {
        p.diceCount = 4;
        p.dice = [];
        p.isReady = false;
        p.hasWon = false;
    });
}

io.on('connection', (socket) => {

    socket.on('joinRoom', ({ username, room, role }) => {
        socket.join(room);
        if (!rooms[room]) {
            rooms[room] = { players: [], spectators: [], currentTurnIndex: 0, currentBid: null, gameActive: false, gameInProgress: false };
        }

        if (role === 'spectator') {
            rooms[room].spectators.push({ id: socket.id, username });
        } else {
            rooms[room].players.push({ id: socket.id, username, dice: [], diceCount: 4, isReady: false, hasWon: false });
        }

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

        // Roll dice only for active players
        room.players.forEach(p => {
            p.dice = [];
            if (p.diceCount > 0) {
                for (let i = 0; i < p.diceCount; i++) {
                    p.dice.push(Math.ceil(Math.random() * 6));
                }
                p.dice.sort((a, b) => a - b);
            }
        });

        // Skip players with no dice
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

        if (r.currentBid &&
            (quantity < r.currentBid.quantity || (quantity === r.currentBid.quantity && face <= r.currentBid.face))
        ) return;

        r.currentBid = { quantity, face, player: socket.id };

        // Rotate turn skipping eliminated players
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

        let safePlayerId, roundLosers = [], message, nextTurnPlayerIndex;

        const challengerIndex = r.currentTurnIndex;
        const bidderIndex = r.players.findIndex(p => p.id === r.currentBid.player);
        const challenger = r.players[challengerIndex];
        const bidder = r.players[bidderIndex];

        if (bidWasTrue) {
            // Challenger was wrong
            safePlayerId = challenger.id;
            nextTurnPlayerIndex = challengerIndex;
            message = `${bidder.username}'s bid was TRUE! Everyone except ${challenger.username} loses a die!`;
        } else {
            // Bidder was lying
            safePlayerId = bidder.id;
            nextTurnPlayerIndex = bidderIndex;
            message = `${bidder.username} was LYING! Everyone except ${bidder.username} loses a die!`;
        }

        // Apply penalties
        r.players.forEach(p => {
            if (p.id !== safePlayerId && p.diceCount > 0) {
                p.diceCount--;
                roundLosers.push(p);
            }
        });

        io.to(roomName).emit('roundOver', {
            allPlayers: r.players,
            message
        });

        // Mark eliminated players
        roundLosers.forEach(p => {
            if (p.diceCount === 0) p.hasWon = true;
        });

        // Check last player standing
        const playersStillIn = r.players.filter(p => p.diceCount > 0);

        if (playersStillIn.length === 1) {
            const loser = playersStillIn[0];
            io.to(roomName).emit('gameOver', { loser: loser.username });
            resetRoom(r);
            setTimeout(() => io.to(roomName).emit('roomUpdate', r), NEXT_ROUND_DELAY);
        } else if (playersStillIn.length === 0) {
            // Edge case: all eliminated simultaneously
            console.error("No players left; all eliminated.");
            resetRoom(r);
            setTimeout(() => io.to(roomName).emit('roomUpdate', r), NEXT_ROUND_DELAY);
        } else {
            // Continue game
            r.currentTurnIndex = nextTurnPlayerIndex;
            setTimeout(() => startGameLogic(r, roomName), NEXT_ROUND_DELAY);
        }
    });

    socket.on('disconnect', () => {
        // Remove player or spectator from all rooms
        for (const roomName in rooms) {
            const room = rooms[roomName];
            room.players = room.players.filter(p => p.id !== socket.id);
            room.spectators = room.spectators.filter(s => s.id !== socket.id);
            io.to(roomName).emit('roomUpdate', room);
        }
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`Server running on port ${PORT}`));
