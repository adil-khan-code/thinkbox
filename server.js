const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');

app.use(express.static(path.join(__dirname, 'public')));

const rooms = {};
const NEXT_ROUND_DELAY = 8000; // 8 seconds

// ---------------------------------------------
// FIXED roundOver() – now works with your rooms
// ---------------------------------------------
function roundOver(room) {
    const activePlayers = room.players.filter(
        p => !p.isSpectator && !p.hasWon && p.diceCount > 0
    );

    // Only ONE player remains → game over
    if (activePlayers.length === 1) {
        const loser = activePlayers[0];

        // Broadcast the loser
        io.to(room.name).emit("gameOver", loser.username);

        // Reset room so they can start a new game
        resetRoom(room);

        // Small delay then update UI
        setTimeout(() => {
            io.to(room.name).emit("roomUpdate", {
                room,
                players: room.players.filter(p => !p.isSpectator)
            });
        }, NEXT_ROUND_DELAY);

        return true;
    }

    return false;
}

// ---------------------------------------------
function resetRoom(room) {
    room.gameInProgress = false;
    room.gameActive = false;
    room.currentBid = null;

    room.players.forEach(p => {
        p.diceCount = p.isSpectator ? 0 : 4;
        p.isReady = false;
        p.dice = [];
        p.hasWon = false;
    });
}

// -----------------------------------------------------
io.on('connection', (socket) => {
    socket.on('joinRoom', ({ username, room, isSpectator }) => {
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

        io.to(room).emit("roomUpdate", {
            room: rooms[room],
            players: rooms[room].players.filter(p => !p.isSpectator)
        });
    });

    // -----------------------------------------------------------------
    socket.on('playerReady', (roomName) => {
        const room = rooms[roomName];
        if (!room) return;

        const player = room.players.find(p => p.id === socket.id);
        if (player) player.isReady = true;

        const allReady =
            room.players.filter(p => !p.isSpectator).every(p => p.isReady);

        if (room.players.length > 1 && allReady) {
            room.gameInProgress = true;
            startGameLogic(room, roomName);
        } else {
            io.to(roomName).emit('roomUpdate', {
                room,
                players: room.players.filter(p => !p.isSpectator)
            });
        }
    });

    // --------------------------------------------------------
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

        // Make sure turn starts on a player with dice
        while (room.players[room.currentTurnIndex].diceCount === 0) {
            room.currentTurnIndex =
                (room.currentTurnIndex + 1) % room.players.length;
        }

        io.to(roomName).emit("gameStarted", room);
    }

    // --------------------------------------------------------
    socket.on("placeBid", ({ room, quantity, face }) => {
        const r = rooms[room]
