// server.js
const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');

app.use(express.static(path.join(__dirname, 'public')));

// Game State
const rooms = {};

io.on('connection', (socket) => {
    console.log('A user connected: ' + socket.id);

    socket.on('joinRoom', ({ username, room }) => {
        socket.join(room);
        
        if (!rooms[room]) {
            rooms[room] = {
                players: [],
                currentTurnIndex: 0,
                currentBid: null, // { quantity: 0, face: 0, player: "" }
                gameActive: false
            };
        }

        const newPlayer = {
            id: socket.id,
            username: username,
            dice: [], // Will hold array like [1, 5, 6, 2, 3]
            diceCount: 5
        };

        rooms[room].players.push(newPlayer);

        // Notify everyone in room
        io.to(room).emit('roomUpdate', rooms[room]);
    });

    socket.on('startGame', (roomName) => {
        const room = rooms[roomName];
        if (room && room.players.length > 1) {
            room.gameActive = true;
            room.currentBid = null;
            room.currentTurnIndex = 0;
            
            // Roll dice for everyone
            room.players.forEach(p => {
                p.dice = [];
                for(let i=0; i < p.diceCount; i++) {
                    p.dice.push(Math.ceil(Math.random() * 6));
                }
            });

            io.to(roomName).emit('gameStarted', room);
            io.to(roomName).emit('roomUpdate', room);
        }
    });

    socket.on('placeBid', ({ room, quantity, face }) => {
        const r = rooms[room];
        if (!r) return;

        // Basic validation (must raise bid)
        if (r.currentBid) {
            if (quantity < r.currentBid.quantity) return; // Must start with higher or equal quantity
            if (quantity === r.currentBid.quantity && face <= r.currentBid.face) return; // If qty equal, face must be higher
        }

        r.currentBid = { quantity, face, player: socket.id };
        
        // Next turn
        r.currentTurnIndex = (r.currentTurnIndex + 1) % r.players.length;
        
        io.to(room).emit('roomUpdate', r);
    });

    socket.on('callLiar', (roomName) => {
        const r = rooms[roomName];
        if (!r || !r.currentBid) return;

        // 1. Reveal all dice
        const allDice = [];
        r.players.forEach(p => allDice.push(...p.dice));

        // 2. Count dice (1s are usually wild in Snyd)
        const targetFace = r.currentBid.face;
        const count = allDice.filter(d => d === targetFace || d === 1).length;

        const bidWasTrue = count >= r.currentBid.quantity;
        
        // 3. Determine loser
        // If bid was true (there were enough dice), the Challenger (current turn) loses.
        // If bid was false (liar!), the Bidder (previous turn) loses.
        let loserIndex;
        if (bidWasTrue) {
            loserIndex = r.currentTurnIndex; // The person who called liar loses
        } else {
            // Find the player who made the bid
            loserIndex = r.players.findIndex(p => p.id === r.currentBid.player);
        }

        const loser = r.players[loserIndex];
        loser.diceCount--;

        // 4. Remove player if 0 dice
        if (loser.diceCount === 0) {
            io.to(roomName).emit('notification', `${loser.username} is out of the game!`);
            // Logic to handle player removal could go here, for simplicity we keep them in but with 0 dice
        }

        // 5. Reset round
        r.gameActive = false;
        r.currentBid = null;
        
        io.to(roomName).emit('roundOver', {
            allPlayers: r.players, // Send full data so everyone sees everyone's dice
            message: `Result: There were ${count} ${targetFace}s (1s are wild). ${loser.username} lost a die!`
        });
        
        // Hide dice again in data for next round start (done in startGame logic)
    });

    socket.on('disconnect', () => {
        // Basic cleanup logic would go here
        console.log('User disconnected');
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
