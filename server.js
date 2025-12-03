const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');

app.use(express.static(path.join(__dirname, 'public')));

const rooms = {};
const NEXT_ROUND_DELAY = 8000; // 8 seconds

// Helper: reset room state for a new game
function resetRoom(room) {
    room.gameInProgress = false;
    room.gameActive = false;
    room.currentBid = null;
    room.currentTurnIndex = 0;
    room.players.forEach(p => {
        p.diceCount = p.isSpectator ? 0 : 4;
        p.isReady = false;
        p.dice = [];
        p.hasWon = false;
    });
}

// Check whether only one active player remains; if so broadcast gameOver and reset room
function roundOver(room) {
    // active = players who are playing (not spectators) and still have dice > 0 and not marked hasWon
    const activePlayers = room.players.filter(p => !p.isSpectator && !p.hasWon && p.diceCount > 0);

    if (activePlayers.length === 1) {
        const loser = activePlayers[0];

        // Broadcast the loser (send username string)
        io.to(room.name).emit('gameOver', loser.username);

        // Reset the room for next game
        resetRoom(room);

        // Send an updated public room snapshot after a short delay so clients move back to lobby
        setTimeout(() => {
            io.to(room.name).emit('roomUpdate', {
                room: room,
                players: room.players.filter(p => !p.isSpectator)
            });
        }, NEXT_ROUND_DELAY);

        return true;
    }

    return false;
}

io.on('connection', (socket) => {

    socket.on('joinRoom', ({ username, room, isSpectator }) => {
        if (!room) return;
        socket.join(room);

        if (!rooms[room]) {
            rooms[room] = {
                name: room,
                players: [],
                currentTurnIndex: 0,
                currentBid: null,
                gameActive: false,
                gameInProgress: false
            };
        }

        const newPlayer = {
            id: socket.id,
            username,
            dice: [],
            diceCount: isSpectator ? 0 : 4,
            isReady: false,
            hasWon: false,
            isSpectator: isSpectator
        };

        rooms[room].players.push(newPlayer);

        io.to(room).emit('roomUpdate', {
            room: rooms[room],
            players: rooms[room].players.filter(p => !p.isSpectator)
        });
    });

    socket.on('playerReady', (roomName) => {
        const room = rooms[roomName];
        if (!room) return;
    
        // Mark this player ready if exists
        const player = room.players.find(p => p.id === socket.id);
        if (player) player.isReady = true;
    
        // Only consider non-spectator players
        const nonSpectators = room.players.filter(p => !p.isSpectator);
    
        // Check if all non-spectators are ready
        const allReady = nonSpectators.every(p => p.isReady);
    
        // Debug log to see what’s happening
        console.log(`Room ${roomName}: ${nonSpectators.length} players, allReady=${allReady}`);
        nonSpectators.forEach(p => console.log(`${p.username}: ${p.isReady}`));
    
        if (allReady && nonSpectators.length > 0) {
            room.gameInProgress = true;
            startGameLogic(room, roomName);
        } else {
            io.to(roomName).emit('roomUpdate', {
                room: room,
                players: nonSpectators
            });
        }
    });

    function startGameLogic(room, roomName) {
        room.gameActive = true;
        room.currentBid = null;

        room.players.forEach(p => {
            p.dice = [];
            if (p.diceCount > 0) {
                for (let i = 0; i < p.diceCount; i++) {
                    p.dice.push(Math.ceil(Math.random() * 6));
                }
                p.dice.sort((a, b) => a - b);
            }
        });

        // Ensure currentTurnIndex points to a player who has dice
        if (room.players.length > 0) {
            let safeIndex = room.currentTurnIndex % room.players.length;
            let checked = 0;
            while (room.players[safeIndex].diceCount === 0 && checked < room.players.length) {
                safeIndex = (safeIndex + 1) % room.players.length;
                checked++;
            }
            room.currentTurnIndex = safeIndex;
        }

        io.to(roomName).emit('gameStarted', {
            room,
            players: room.players.filter(p => !p.isSpectator)
        });
    }

    socket.on('placeBid', ({ room, quantity, face }) => {
        const r = rooms[room];
        if (!r || !r.gameActive) return;

        if (r.currentBid && (quantity < r.currentBid.quantity || (quantity === r.currentBid.quantity && face <= r.currentBid.face))) return;

        r.currentBid = { quantity, face, player: socket.id };

        // advance turn to next player with dice
        if (r.players && r.players.length > 0) {
            do {
                r.currentTurnIndex = (r.currentTurnIndex + 1) % r.players.length;
            } while (r.players[r.currentTurnIndex].diceCount === 0);
        }

        io.to(room).emit('roomUpdate', {
            room: r,
            players: r.players.filter(p => !p.isSpectator)
        });
    });

    socket.on('callLiar', (roomName) => {
        const r = rooms[roomName];
        if (!r || !r.currentBid) return;
        r.gameActive = false;

        const allDice = r.players.flatMap(p => p.dice);
        const targetFace = r.currentBid.face;
        const count = allDice.filter(d => d === targetFace || d === 1).length;
        const bidWasTrue = count >= r.currentBid.quantity;

        const challengerIndex = r.currentTurnIndex;
        const bidderIndex = r.players.findIndex(p => p.id === r.currentBid.player);
        const challenger = r.players[challengerIndex];
        const bidder = r.players[bidderIndex];

        let safePlayerId;
        let message;
        let nextTurnPlayerIndex = challengerIndex;

        if (bidWasTrue) {
            safePlayerId = challenger.id;
            nextTurnPlayerIndex = challengerIndex;
            message = `${bidder.username}'s bid was TRUE! Everyone except ${challenger.username} loses a die!`;
        } else {
            safePlayerId = bidder.id;
            nextTurnPlayerIndex = bidderIndex;
            message = `${bidder.username} was LYING! Everyone except ${bidder.username} loses a die!`;
        }

        // Apply penalty
        r.players.forEach(p => {
            if (p.id !== safePlayerId && p.diceCount > 0) {
                p.diceCount--;
                if (p.diceCount === 0) p.hasWon = true;
            }
        });

        io.to(roomName).emit('roundOver', {
            allPlayers: r.players,
            message
        });

        // Check if the round/game is over now
        if (roundOver(r)) {
            // roundOver already emitted gameOver and reset room
            return;
        }

        // Not over: set the next currentTurnIndex and start next round after delay
        r.currentTurnIndex = nextTurnPlayerIndex;
        setTimeout(() => startGameLogic(r, roomName), NEXT_ROUND_DELAY);
    });

    socket.on('disconnect', () => {
        // remove disconnected player from any room they were in
        for (const roomName in rooms) {
            const room = rooms[roomName];
            const idx = room.players.findIndex(p => p.id === socket.id);
            if (idx !== -1) {
                room.players.splice(idx, 1);
                io.to(roomName).emit('roomUpdate', {
                    room: room,
                    players: room.players.filter(p => !p.isSpectator)
                });
            }
        }
    });

}); // end io.on('connection')

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`Server running on port ${PORT}`));
