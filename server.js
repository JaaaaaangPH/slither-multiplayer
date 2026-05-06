const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname)));

const lobbies = new Map();

function generateCode() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

function getLobbyList() {
    const list = [];
    lobbies.forEach((lobby, code) => {
        if (lobby.players.size < 5 && !lobby.started) {
            list.push({
                code,
                host: lobby.host.name,
                players: lobby.players.size,
                maxPlayers: 5
            });
        }
    });
    return list;
}

function getColorForId(id) {
    const colors = ['#ff4444', '#44ff44', '#4444ff', '#ffff44', '#ff44ff', '#44ffff', '#ff8844', '#88ff44'];
    let hash = 0;
    for (let i = 0; i < id.length; i++) {
        hash = id.charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash) % colors.length];
}

function getLeaderboard(lobby) {
    const players = Array.from(lobby.players.values());
    return players.map(p => ({ name: p.name, id: p.id, score: p.score || 0 }))
        .sort((a, b) => b.score - a.score);
}

function checkWinner(lobby, code) {
    if (!lobby || !lobby.started) return;
    const alivePlayers = Array.from(lobby.players.values()).filter(p => p.alive !== false);
    console.log('checkWinner:', { aliveCount: alivePlayers.length, total: lobby.players.size, started: lobby.started, players: Array.from(lobby.players.values()).map(p => ({name: p.name, alive: p.alive})) });
    if (alivePlayers.length <= 1) {
        const winner = alivePlayers[0];
        if (winner) {
            console.log('Announcing winner:', winner.name);
            io.to(code).emit('gameOver', { winner: winner.name, leaderboard: getLeaderboard(lobby), gameId: lobby.gameId });
        } else {
            console.log('No winner - all players dead');
            io.to(code).emit('gameOver', { winner: 'No one', leaderboard: getLeaderboard(lobby), gameId: lobby.gameId });
        }
        lobby.started = false;
    }
}

io.on('connection', (socket) => {
    console.log('Player connected:', socket.id);

    socket.on('createLobby', (playerName) => {
        const code = generateCode();
        const player = { id: socket.id, name: playerName, ready: false, score: 0, alive: true, color: getColorForId(socket.id) };
        
        lobbies.set(code, {
            host: player,
            players: new Map([[socket.id, player]]),
            started: false,
            gameState: null
        });

        socket.join(code);
        socket.lobbyCode = code;
        socket.playerName = playerName;

        socket.emit('lobbyCreated', { code, players: [player] });
        io.emit('lobbyListUpdate', getLobbyList());
    });

    socket.on('joinLobby', ({ code, playerName }) => {
        const lobby = lobbies.get(code);
        
        if (!lobby) {
            socket.emit('error', 'Lobby not found');
            return;
        }
        if (lobby.players.size >= 5) {
            socket.emit('error', 'Lobby is full');
            return;
        }
        if (lobby.started) {
            socket.emit('error', 'Game already started');
            return;
        }

        const player = { id: socket.id, name: playerName, ready: false, score: 0, alive: true, color: getColorForId(socket.id) };
        lobby.players.set(socket.id, player);
        socket.join(code);
        socket.lobbyCode = code;
        socket.playerName = playerName;

        const players = Array.from(lobby.players.values());
        io.to(code).emit('playerJoined', { players, newPlayer: player });
        io.emit('lobbyListUpdate', getLobbyList());
    });

    socket.on('getLobbies', () => {
        socket.emit('lobbyList', getLobbyList());
    });

    socket.on('toggleReady', () => {
        const lobby = lobbies.get(socket.lobbyCode);
        if (!lobby || lobby.started) return;

        const player = lobby.players.get(socket.id);
        if (player) {
            player.ready = !player.ready;
            const players = Array.from(lobby.players.values());
            io.to(socket.lobbyCode).emit('playerReadyUpdate', { players });
        }
    });

    socket.on('kickPlayer', (playerId) => {
        const lobby = lobbies.get(socket.lobbyCode);
        if (!lobby || lobby.host.id !== socket.id) return;

        const player = lobby.players.get(playerId);
        if (player && player.id !== socket.id) {
            lobby.players.delete(playerId);
            io.to(playerId).emit('kicked');
            const players = Array.from(lobby.players.values());
            io.to(socket.lobbyCode).emit('playerListUpdate', { players });
            io.emit('lobbyListUpdate', getLobbyList());
        }
    });

    socket.on('startGame', () => {
        const lobby = lobbies.get(socket.lobbyCode);
        console.log('startGame triggered', { lobby: !!lobby, isHost: lobby && lobby.host.id === socket.id, started: lobby && lobby.started });
        if (!lobby || lobby.host.id !== socket.id || lobby.started) return;

        const allReady = Array.from(lobby.players.values()).every(p => p.ready);
        if (!allReady) {
            socket.emit('error', 'Not all players are ready');
            return;
        }

        console.log('startGame called by host:', socket.id, 'lobby:', socket.lobbyCode);
        lobby.started = true;
        lobby.gameId = Date.now();
        lobby.players.forEach((player) => {
            player.alive = true;
            player.score = 0;
            console.log('Player', player.name, 'set to alive:', player.alive);
        });
        const players = Array.from(lobby.players.values());
        var playerIndex = 0;
        lobby.players.forEach((player, id) => {
            var angle = (playerIndex / players.length) * Math.PI * 2;
            var spawnPos = {
                x: 2000 + Math.cos(angle) * 800,
                y: 2000 + Math.sin(angle) * 800
            };
            io.to(id).emit('gameStarting', { player, spawnPos, gameId: lobby.gameId });
            playerIndex++;
        });
    });

    socket.on('gameUpdate', (data) => {
        const lobby = lobbies.get(socket.lobbyCode);
        if (!lobby || !lobby.started) return;
        const player = lobby.players.get(socket.id);
        if (player && data.score !== undefined) {
            player.score = data.score;
        }
        socket.to(socket.lobbyCode).emit('opponentUpdate', { id: socket.id, color: player.color, ...data });
        io.to(socket.lobbyCode).emit('leaderboardUpdate', { leaderboard: getLeaderboard(lobby) });
    });

    socket.on('playerDied', (data) => {
        const lobby = lobbies.get(socket.lobbyCode);
        if (!lobby || !lobby.started) return;
        const player = lobby.players.get(socket.id);
        if (player) {
            player.alive = false;
        }
        socket.to(socket.lobbyCode).emit('opponentDied', { id: socket.id, segments: data.segments });
        checkWinner(lobby, socket.lobbyCode);
    });

    socket.on('disconnect', () => {
        const code = socket.lobbyCode;
        if (!code) return;

        const lobby = lobbies.get(code);
        if (!lobby) return;

        const wasInGame = lobby.started;
        lobby.players.delete(socket.id);

        if (lobby.players.size === 0) {
            lobbies.delete(code);
        } else {
            if (socket.id === lobby.host.id) {
                const newHost = lobby.players.values().next().value;
                lobby.host = newHost;
                io.to(code).emit('newHost', { host: newHost });
            }
            if (wasInGame && lobby.started) {
                checkWinner(lobby, code);
            }
            const players = Array.from(lobby.players.values());
            io.to(code).emit('playerLeft', { players, leftId: socket.id });
        }

        io.emit('lobbyListUpdate', getLobbyList());
        console.log('Player disconnected:', socket.id);
    });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
