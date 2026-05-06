var canvas = document.getElementById('gameCanvas');
var ctx = canvas.getContext('2d');
var startScreen = document.getElementById('startScreen');
var lobbyScreen = document.getElementById('lobbyScreen');
var lobbyListScreen = document.getElementById('lobbyListScreen');
var joinScreen = document.getElementById('joinScreen');
var deathScreen = document.getElementById('deathScreen');
var landscapePrompt = document.getElementById('landscapePrompt');
var boostBtn = document.getElementById('boostBtn');
var nameInput = document.getElementById('nameInput');
var codeInput = document.getElementById('codeInput');
var BOOST_FRAMES = 30;
var BOOST_COOLDOWN_FRAMES = 120;
var boostActive = false;
var boostCooldown = false;
var boostTimer = 0;
var boostCooldownTimer = 0;
var lobbyCodeEl = document.getElementById('lobbyCode');
var playerListEl = document.getElementById('playerList');
var lobbyListEl = document.getElementById('lobbyList');
var deathScore = document.getElementById('deathScore');
var errorToast = document.getElementById('errorToast');
var leaderboard = [];
var gameOverScreen = null;
var inGame = false;
var socketEventsSetup = false;
var currentGameId = null;

canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

var WORLD_SIZE = 4000;
var FOOD_COUNT = 500;
var SNAKE_RADIUS = 14;
var FOOD_RADIUS = 5;
var SPEED = 2.5;
var TURN_SPEED = 0.08;

var mouse = { x: canvas.width / 2, y: canvas.height / 2 };
var camera = { x: 0, y: 0 };
var gameRunning = false;
var gameTicks = 0;
var player = null;
var foods = [];
var playerName = 'Player';
var isHost = false;
var socket = null;
var socketServerUrl = location.protocol + '//' + location.hostname + ':3001';
var otherPlayers = {};

var minimapSize = 150;
var minimap = document.createElement('canvas');
minimap.id = 'minimap';
minimap.width = minimapSize;
minimap.height = minimapSize;
minimap.style.position = 'fixed';
minimap.style.bottom = '20px';
minimap.style.right = '20px';
minimap.style.border = '2px solid #444';
minimap.style.background = 'rgba(0,0,0,0.7)';
minimap.style.zIndex = '5';
document.body.appendChild(minimap);
var miniCtx = minimap.getContext('2d');

function hideAllScreens() {
    startScreen.style.display = 'none';
    lobbyScreen.style.display = 'none';
    lobbyListScreen.style.display = 'none';
    joinScreen.style.display = 'none';
    deathScreen.style.display = 'none';
    landscapePrompt.style.display = 'none';
    if (gameOverScreen) gameOverScreen.style.display = 'none';
}

function resetMobileLayout() {
    document.body.classList.remove('landscape-fallback');
    if (document.fullscreenElement) {
        document.exitFullscreen().catch(function() {});
    }
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    updateBoostButton();
}

function showError(msg) {
    errorToast.textContent = msg;
    errorToast.style.display = 'block';
    setTimeout(function() { errorToast.style.display = 'none'; }, 3000);
}

function showGameOverScreen(winner, lb) {
    if (!gameOverScreen) {
        gameOverScreen = document.createElement('div');
        gameOverScreen.id = 'gameOverScreen';
        gameOverScreen.className = 'screen';
        gameOverScreen.innerHTML = '<div id="gameOverBox"><h2 id="gameOverTitle"></h2><div id="gameOverLeaderboard"></div><button id="gameOverBtn">PLAY AGAIN</button></div>';
        document.body.appendChild(gameOverScreen);
        var gameOverBtn = document.getElementById('gameOverBtn');
        gameOverBtn.addEventListener('click', function() {
            gameOverScreen.style.display = 'none';
            inGame = false;
            socketEventsSetup = false;
            if (socket) { socket.disconnect(); socket = null; }
            resetMobileLayout();
            hideAllScreens();
            startScreen.style.display = 'flex';
        });
        gameOverBtn.addEventListener('touchstart', function(e) {
            e.preventDefault();
            gameOverScreen.style.display = 'none';
            inGame = false;
            socketEventsSetup = false;
            if (socket) { socket.disconnect(); socket = null; }
            resetMobileLayout();
            hideAllScreens();
            startScreen.style.display = 'flex';
        });
    }
    document.getElementById('gameOverTitle').textContent = winner + ' WINS!';
    var lbHtml = '<h3>LEADERBOARD</h3>';
    for (var i = 0; i < lb.length; i++) {
        lbHtml += '<div class="lb-entry"><span>' + (i+1) + '. ' + lb[i].name + '</span><span>' + lb[i].score + '</span></div>';
    }
    document.getElementById('gameOverLeaderboard').innerHTML = lbHtml;
    gameOverScreen.style.display = 'flex';
}

function darkenColor(color, factor) {
    var r = parseInt(color.slice(1,3), 16);
    var g = parseInt(color.slice(3,5), 16);
    var b = parseInt(color.slice(5,7), 16);
    r = Math.floor(r * factor);
    g = Math.floor(g * factor);
    b = Math.floor(b * factor);
    return 'rgb(' + r + ',' + g + ',' + b + ')';
}

function Snake(x, y, color, name, isPlayer) {
    this.segments = [];
    this.radius = SNAKE_RADIUS;
    this.color = color;
    this.darkColor = darkenColor(color, 0.7);
    this.angle = Math.random() * Math.PI * 2;
    this.score = 0;
    this.name = name || 'Player';
    this.dead = false;
    this.isPlayer = isPlayer || false;
    this.alive = true;
    for (var i = 0; i < 20; i++) {
        this.segments.push({
            x: x - Math.cos(this.angle) * i * this.radius * 1.8,
            y: y - Math.sin(this.angle) * i * this.radius * 1.8
        });
    }
}

Snake.prototype.update = function(targetX, targetY) {
    if (this.dead) return;
    var head = this.segments[0];
    if (this.isPlayer) {
        var dx = targetX - (head.x - camera.x);
        var dy = targetY - (head.y - camera.y);
        var targetAngle = Math.atan2(dy, dx);
        var angleDiff = targetAngle - this.angle;
        while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
        while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
        this.angle += angleDiff * TURN_SPEED;
    }
    var speed = SPEED;
    if (this.isPlayer && boostActive) {
        speed = SPEED * 1.8;
    }
    var newHead = {
        x: head.x + Math.cos(this.angle) * speed,
        y: head.y + Math.sin(this.angle) * speed
    };
    if (newHead.x < 0) newHead.x = WORLD_SIZE;
    if (newHead.x > WORLD_SIZE) newHead.x = 0;
    if (newHead.y < 0) newHead.y = WORLD_SIZE;
    if (newHead.y > WORLD_SIZE) newHead.y = 0;
    this.segments.unshift(newHead);
    if (this.segments.length > 20 + this.score) {
        this.segments.pop();
    }
};

Snake.prototype.draw = function() {
    if (this.dead) return;
    var len = this.segments.length;
    for (var i = len - 1; i >= 0; i--) {
        var seg = this.segments[i];
        var screenX = seg.x - camera.x;
        var screenY = seg.y - camera.y;
        if (screenX < -150 || screenX > canvas.width + 150) continue;
        if (screenY < -150 || screenY > canvas.height + 150) continue;
        var progress = i / len;
        var r = this.radius * (0.4 + progress * 0.6);
        if (r < 3) r = 3;
        ctx.beginPath();
        ctx.arc(screenX, screenY, r, 0, Math.PI * 2);
        ctx.fillStyle = i < 3 ? this.color : this.darkColor;
        ctx.fill();
    }
    var head = this.segments[0];
    var headX = head.x - camera.x;
    var headY = head.y - camera.y;
    ctx.beginPath();
    ctx.arc(headX, headY, this.radius, 0, Math.PI * 2);
    ctx.fillStyle = this.color;
    ctx.fill();
    var eyeAngle = 0.7;
    var eyeDist = this.radius * 0.5;
    var eyeR = this.radius * 0.38;
    var leftEyeX = headX + Math.cos(this.angle + eyeAngle) * eyeDist;
    var leftEyeY = headY + Math.sin(this.angle + eyeAngle) * eyeDist;
    var rightEyeX = headX + Math.cos(this.angle - eyeAngle) * eyeDist;
    var rightEyeY = headY + Math.sin(this.angle - eyeAngle) * eyeDist;
    ctx.beginPath();
    ctx.arc(leftEyeX, leftEyeY, eyeR, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(rightEyeX, rightEyeY, eyeR, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
    var pupilR = eyeR * 0.55;
    var pupilDist = eyeR * 0.25;
    ctx.beginPath();
    ctx.arc(leftEyeX + Math.cos(this.angle) * pupilDist, leftEyeY + Math.sin(this.angle) * pupilDist, pupilR, 0, Math.PI * 2);
    ctx.fillStyle = '#000';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(rightEyeX + Math.cos(this.angle) * pupilDist, rightEyeY + Math.sin(this.angle) * pupilDist, pupilR, 0, Math.PI * 2);
    ctx.fillStyle = '#000';
    ctx.fill();
    var nameX = headX;
    var nameY = headY - this.radius - 12;
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 14px Arial';
    ctx.textAlign = 'center';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 3;
    ctx.strokeText(this.name, nameX, nameY);
    ctx.fillText(this.name, nameX, nameY);
};

Snake.prototype.checkHeadCollision = function(otherSnake) {
    if (this.dead || otherSnake.dead) return false;
    var myHead = this.segments[0];
    var startIndex = 1;
    if (this === otherSnake) {
        startIndex = Math.max(12, Math.floor(otherSnake.segments.length * 0.5));
    }
    for (var i = startIndex; i < otherSnake.segments.length; i++) {
        var seg = otherSnake.segments[i];
        var dx = myHead.x - seg.x;
        var dy = myHead.y - seg.y;
        var dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < this.radius + otherSnake.radius * 0.7) {
            return true;
        }
    }
    return false;
};

Snake.prototype.die = function() {
    this.dead = true;
    this.alive = false;
    for (var i = 0; i < this.segments.length; i += 3) {
        foods.push({
            x: this.segments[i].x + (Math.random() - 0.5) * 20,
            y: this.segments[i].y + (Math.random() - 0.5) * 20,
            color: ['#ff5555', '#55ff55', '#5555ff', '#ffff55', '#ff55ff'][Math.floor(Math.random() * 5)]
        });
    }
    if (socket && gameRunning) {
        socket.emit('playerDied', { segments: this.segments });
    }
};

function drawLeaderboard() {
    if (!leaderboard || leaderboard.length === 0) return;
    var lbX = canvas.width - 220;
    var lbY = 20;
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(lbX - 10, lbY - 10, 210, 30 + leaderboard.length * 25);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 16px Arial';
    ctx.textAlign = 'left';
    ctx.fillText('LEADERBOARD', lbX, lbY + 10);
    for (var i = 0; i < leaderboard.length; i++) {
        var entry = leaderboard[i];
        var y = lbY + 35 + i * 25;
        ctx.font = '14px Arial';
        ctx.fillStyle = entry.name === playerName ? '#00ff88' : '#fff';
        ctx.fillText((i+1) + '. ' + entry.name + ': ' + entry.score, lbX, y);
    }
}

function spawnFood() {
    return {
        x: Math.random() * WORLD_SIZE,
        y: Math.random() * WORLD_SIZE,
        color: ['#ff5555', '#55ff55', '#5555ff', '#ffff55', '#ff55ff'][Math.floor(Math.random() * 5)]
    };
}

function initGame(spawnPos, playerColor) {
    var spawnX, spawnY;
    if (spawnPos) {
        spawnX = spawnPos.x;
        spawnY = spawnPos.y;
    } else {
        var spawnAngle = Math.random() * Math.PI * 2;
        var spawnDist = 500 + Math.random() * 500;
        spawnX = WORLD_SIZE / 2 + Math.cos(spawnAngle) * spawnDist;
        spawnY = WORLD_SIZE / 2 + Math.sin(spawnAngle) * spawnDist;
        spawnX = Math.max(100, Math.min(WORLD_SIZE - 100, spawnX));
        spawnY = Math.max(100, Math.min(WORLD_SIZE - 100, spawnY));
    }
    player = new Snake(spawnX, spawnY, playerColor || '#00ff88', playerName, true);
    foods = [];
    otherPlayers = {};
    leaderboard = [];
    gameTicks = 0;
    for (var i = 0; i < FOOD_COUNT; i++) {
        foods.push(spawnFood());
    }
}

function drawGrid() {
    ctx.strokeStyle = '#1a1a1a';
    ctx.lineWidth = 1;
    var gridSize = 100;
    var startX = -(camera.x % gridSize);
    var startY = -(camera.y % gridSize);
    for (var x = startX; x < canvas.width; x += gridSize) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, canvas.height);
        ctx.stroke();
    }
    for (var y = startY; y < canvas.height; y += gridSize) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(canvas.width, y);
        ctx.stroke();
    }
}

function drawFood() {
    for (var i = 0; i < foods.length; i++) {
        var f = foods[i];
        var screenX = f.x - camera.x;
        var screenY = f.y - camera.y;
        if (screenX < -10 || screenX > canvas.width + 10) continue;
        if (screenY < -10 || screenY > canvas.height + 10) continue;
        ctx.beginPath();
        ctx.arc(screenX, screenY, FOOD_RADIUS, 0, Math.PI * 2);
        ctx.fillStyle = f.color;
        ctx.fill();
    }
}

function drawMinimap() {
    miniCtx.fillStyle = '#111';
    miniCtx.fillRect(0, 0, minimapSize, minimapSize);
    var scale = minimapSize / WORLD_SIZE;
    for (var i = 0; i < foods.length; i++) {
        var f = foods[i];
        miniCtx.fillStyle = f.color;
        miniCtx.fillRect(f.x * scale, f.y * scale, 1, 1);
    }
    var ids = Object.keys(otherPlayers);
    for (var j = 0; j < ids.length; j++) {
        var p = otherPlayers[ids[j]];
        if (!p || !p.segments) continue;
        var head = p.segments[0];
        miniCtx.fillStyle = p.color;
        miniCtx.fillRect(head.x * scale - 2, head.y * scale - 2, 4, 4);
    }
    if (player && !player.dead) {
        var head2 = player.segments[0];
        miniCtx.fillStyle = player.color;
        miniCtx.fillRect(head2.x * scale - 3, head2.y * scale - 3, 6, 6);
    }
    miniCtx.strokeStyle = '#555';
    miniCtx.lineWidth = 2;
    miniCtx.strokeRect(0, 0, minimapSize, minimapSize);
    var viewX = camera.x * scale;
    var viewY = camera.y * scale;
    miniCtx.strokeStyle = '#fff';
    miniCtx.lineWidth = 1;
    miniCtx.strokeRect(viewX, viewY, canvas.width * scale, canvas.height * scale);
}

function checkAllCollisions() {
    if (!player || player.dead) return;
    if (boostActive && player.dead) {
        boostActive = false;
        boostCooldown = false;
    }
    if (gameTicks > 10 && player.checkHeadCollision(player)) {
        player.die();
        return;
    }
    var ids = Object.keys(otherPlayers);
    for (var i = 0; i < ids.length; i++) {
        var other = otherPlayers[ids[i]];
        if (player.checkHeadCollision(other)) {
            player.die();
            return;
        }
    }
}

function gameLoop() {
    if (!gameRunning) return;
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    drawGrid();
    camera.x = player.segments[0].x - canvas.width / 2;
    camera.y = player.segments[0].y - canvas.height / 2;
    player.update(mouse.x, mouse.y);
    var head = player.segments[0];
    for (var i = foods.length - 1; i >= 0; i--) {
        var f = foods[i];
        var dx = head.x - f.x;
        var dy = head.y - f.y;
        var dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < player.radius + FOOD_RADIUS) {
            player.score += 1;
            foods.splice(i, 1);
        }
    }
    checkAllCollisions();
    if (player.dead) {
        gameRunning = false;
        deathScore.textContent = 'Score: ' + player.score;
        deathScreen.style.display = 'flex';
        document.body.style.cursor = 'default';
        return;
    }
    player.draw();
    var ids = Object.keys(otherPlayers);
    for (var k = 0; k < ids.length; k++) {
        otherPlayers[ids[k]].draw();
    }
    drawFood();
    drawMinimap();
    while (foods.length < FOOD_COUNT) {
        foods.push(spawnFood());
    }
    ctx.fillStyle = '#fff';
    ctx.font = '20px Arial';
    ctx.textAlign = 'left';
    ctx.fillText('Score: ' + player.score, 20, 40);
    if (boostActive) {
        ctx.fillStyle = '#0f0';
        ctx.fillText('BOOST!', 20, 70);
    } else if (boostCooldown) {
        ctx.fillStyle = '#f90';
        ctx.fillText('Boost ready in ' + Math.ceil(boostCooldownTimer / 60) + 's', 20, 70);
    }
    drawLeaderboard();
    gameTicks++;
    if (boostActive) {
        boostTimer--;
        if (boostTimer <= 0) {
            boostActive = false;
        }
    }
    if (boostCooldown) {
        boostCooldownTimer--;
        if (boostCooldownTimer <= 0) {
            boostCooldown = false;
            updateBoostButton();
        }
    }
    if (socket && gameRunning) {
        socket.emit('gameUpdate', {
            x: player.segments[0].x,
            y: player.segments[0].y,
            angle: player.angle,
            score: player.score,
            segments: player.segments.slice(0, Math.min(player.segments.length, 20 + Math.floor(player.score))),
            name: playerName
        });
    }
    requestAnimationFrame(gameLoop);
}

function updatePlayerList(players) {
    playerListEl.innerHTML = '';
    for (var i = 0; i < players.length; i++) {
        var p = players[i];
        var div = document.createElement('div');
        var className = 'player-item';
        if (p.ready) className += ' ready';
        if (p.id === (socket && socket.id)) className += ' host';
        div.className = className;
        var html = '<span class="player-name">' + p.name;
        if (p.id === (socket && socket.id)) html += ' (You)';
        html += '</span><span class="player-status">';
        html += p.ready ? 'READY' : 'NOT READY';
        html += '</span>';
        if (isHost && p.id !== socket.id) {
            html += '<button class="kick-btn" onclick="window.kickPlayer(\'' + p.id + '\')">KICK</button>';
        }
        div.innerHTML = html;
        playerListEl.appendChild(div);
    }
}

window.kickPlayer = function(id) {
    if (socket) socket.emit('kickPlayer', id);
};

function joinLobbyByCode(code) {
    if (!code || code.length !== 6) {
        showError('Invalid code');
        return;
    }
    if (!nameInput.value.trim()) {
        showError('Enter your name first');
        return;
    }
    playerName = nameInput.value.trim();
    socketEventsSetup = false;
    socket = io(socketServerUrl);
    socket.emit('joinLobby', { code: code, playerName: playerName });
    socket.on('error', function(msg) { showError(msg); });
    socket.on('playerJoined', function(data) {
        lobbyCodeEl.textContent = code;
        updatePlayerList(data.players);
        isHost = false;
        document.getElementById('hostControls').style.display = 'none';
        hideAllScreens();
        lobbyScreen.style.display = 'flex';
    });
    setupSocketEvents();
}

function setupSocketEvents() {
    if (socketEventsSetup) return;
    socketEventsSetup = true;
    socket.on('playerListUpdate', function(data) {
        updatePlayerList(data.players);
    });
    socket.on('playerReadyUpdate', function(data) {
        updatePlayerList(data.players);
    });
    socket.on('newHost', function(data) {
        isHost = data.host.id === socket.id;
        document.getElementById('hostControls').style.display = isHost ? 'block' : 'none';
    });
    socket.on('gameStarting', function(data) {
        hideAllScreens();
        document.body.classList.add('gameplay');
        initGame(data.spawnPos, data.player && data.player.color);
        gameRunning = true;
        inGame = true;
        currentGameId = data.gameId;
        if (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) {
            attemptLandscapeLock();
            setupMobileControls();
        }
        requestAnimationFrame(gameLoop);
    });
    socket.on('opponentUpdate', function(data) {
        if (data.id === socket.id) return;
        var other = otherPlayers[data.id];
        if (!other) {
            other = new Snake(data.x || WORLD_SIZE/2, data.y || WORLD_SIZE/2, data.color || getColorForId(data.id), data.name || 'Player', false);
            otherPlayers[data.id] = other;
        }
        if (data.color) {
            other.color = data.color;
            other.darkColor = darkenColor(data.color, 0.7);
        }
        if (data.segments) {
            var targetLen = 20 + Math.floor(data.score || 0);
            var newSegments = data.segments.slice();
            while (newSegments.length < targetLen) {
                var last = newSegments[newSegments.length - 1];
                var prev = newSegments[newSegments.length - 2] || newSegments[0];
                newSegments.push({
                    x: last.x + (last.x - prev.x),
                    y: last.y + (last.y - prev.y)
                });
            }
            other.segments = newSegments.slice(0, targetLen);
            other.angle = data.angle;
        }
        if (data.score !== undefined) {
            other.score = data.score;
        }
    });

    socket.on('opponentDied', function(data) {
        var other = otherPlayers[data.id];
        if (other) {
            for (var i = 0; i < other.segments.length; i += 3) {
                foods.push({
                    x: other.segments[i].x + (Math.random() - 0.5) * 20,
                    y: other.segments[i].y + (Math.random() - 0.5) * 20,
                    color: ['#ff5555', '#55ff55', '#5555ff', '#ffff55', '#ff55ff'][Math.floor(Math.random() * 5)]
                });
            }
            delete otherPlayers[data.id];
        }
    });

    socket.on('leaderboardUpdate', function(data) {
        leaderboard = data.leaderboard;
    });

    socket.on('gameOver', function(data) {
        if (!inGame) return;
        if (data.gameId && data.gameId !== currentGameId) return;
        gameRunning = false;
        inGame = false;
        document.body.classList.remove('gameplay');
        showGameOverScreen(data.winner, data.leaderboard);
    });
    socket.on('playerLeft', function(data) {
        delete otherPlayers[data.leftId];
        updatePlayerList(data.players);
    });
    socket.on('kicked', function() {
        hideAllScreens();
        resetMobileLayout();
        startScreen.style.display = 'flex';
        showError('You were kicked from the lobby');
        inGame = false;
        socketEventsSetup = false;
        socket.disconnect();
        socket = null;
    });
}

function addTouchClick(id, fn) {
    var el = document.getElementById(id);
    if (!el) { console.log('Element not found:', id); return; }
    el.addEventListener('click', fn);
    el.addEventListener('touchend', function(e) {
        e.preventDefault();
        e.stopPropagation();
        fn(e);
    }, { passive: false });
}

addTouchClick('createLobbyBtn', function() {
    if (!nameInput.value.trim()) {
        showError('Enter your name first');
        return;
    }
    playerName = nameInput.value.trim();
    socketEventsSetup = false;
    socket = io(socketServerUrl);
    socket.emit('createLobby', playerName);
    socket.on('lobbyCreated', function(data) {
        lobbyCodeEl.textContent = data.code;
        updatePlayerList(data.players);
        isHost = true;
        document.getElementById('hostControls').style.display = 'block';
        hideAllScreens();
        lobbyScreen.style.display = 'flex';
    });
    socket.on('error', function(msg) { showError(msg); });
    setupSocketEvents();
});

addTouchClick('joinLobbyBtn', function() {
    if (!nameInput.value.trim()) {
        showError('Enter your name first');
        return;
    }
    hideAllScreens();
    joinScreen.style.display = 'flex';
});

addTouchClick('joinBtn', function() {
    joinLobbyByCode(codeInput.value.trim());
});

addTouchClick('joinBackBtn', function() {
    hideAllScreens();
    startScreen.style.display = 'flex';
});

addTouchClick('browseLobbiesBtn', function() {
    if (!nameInput.value.trim()) {
        showError('Enter your name first');
        return;
    }
    playerName = nameInput.value.trim();
    socketEventsSetup = false;
    socket = io(socketServerUrl);
    socket.emit('getLobbies');
    socket.on('lobbyList', function(list) {
        lobbyListEl.innerHTML = '';
        if (list.length === 0) {
            lobbyListEl.innerHTML = '<p style="color:#888">No lobbies available</p>';
        } else {
            for (var i = 0; i < list.length; i++) {
                var lobby = list[i];
                var div = document.createElement('div');
                div.className = 'lobby-item';
                div.innerHTML = '<div class="lobby-info"><div class="lobby-code">' + lobby.code + '</div><div class="lobby-players">Host: ' + lobby.host + ' | Players: ' + lobby.players + '/5</div></div><button onclick="window.joinLobbyByCode(\'' + lobby.code + '\')">JOIN</button>';
                lobbyListEl.appendChild(div);
            }
        }
        hideAllScreens();
        lobbyListScreen.style.display = 'flex';
    });
    setupSocketEvents();
});

addTouchClick('backBtn', function() {
    inGame = false;
    socketEventsSetup = false;
    if (socket) socket.disconnect();
    socket = null;
    resetMobileLayout();
    hideAllScreens();
    startScreen.style.display = 'flex';
});

addTouchClick('readyBtn', function() {
    if (socket) {
        socket.emit('toggleReady');
        document.getElementById('readyBtn').classList.toggle('ready');
    }
});

addTouchClick('startGameBtn', function() {
    if (socket) socket.emit('startGame');
});

addTouchClick('leaveLobbyBtn', function() {
    inGame = false;
    socketEventsSetup = false;
    if (socket) socket.disconnect();
    socket = null;
    resetMobileLayout();
    hideAllScreens();
    startScreen.style.display = 'flex';
});

addTouchClick('retryBtn', function() {
    deathScreen.style.display = 'none';
    inGame = false;
    socketEventsSetup = false;
    if (socket) {
        socket.disconnect();
        socket = null;
    }
    resetMobileLayout();
    hideAllScreens();
    startScreen.style.display = 'flex';
});

canvas.addEventListener('mousemove', function(e) {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
});

codeInput.addEventListener('keypress', function(e) {
    if (e.key === 'Enter') document.getElementById('joinBtn').click();
});

window.addEventListener('resize', function() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
});

function triggerBoost() {
    console.log('triggerBoost called, gameRunning:', gameRunning, 'boostCooldown:', boostCooldown, 'player:', !!player, 'player.dead:', player ? player.dead : 'no player');
    if (!gameRunning || boostCooldown || !player || player.dead) return;
    boostActive = true;
    boostCooldown = true;
    boostTimer = BOOST_FRAMES;
    boostCooldownTimer = BOOST_COOLDOWN_FRAMES;
    updateBoostButton();
}

function updateBoostButton() {
    if (!boostBtn) return;
    boostBtn.classList.remove('active', 'cooldown');
    if (boostActive) {
        boostBtn.classList.add('active');
        boostBtn.disabled = true;
    } else if (boostCooldown) {
        boostBtn.classList.add('cooldown');
        boostBtn.disabled = true;
    } else {
        boostBtn.disabled = false;
    }
}

if (boostBtn) {
    boostBtn.addEventListener('click', function() {
        console.log('boost button click');
        triggerBoost();
    });
    boostBtn.addEventListener('touchend', function(e) {
        console.log('boost button touchend');
        e.preventDefault();
        triggerBoost();
    }, { passive: false });
    updateBoostButton();
}

document.addEventListener('keydown', function(e) {
    if (e.code === 'Space') {
        e.preventDefault();
        triggerBoost();
    }
});

function attemptLandscapeLock() {
    if (!/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) return;
    if (!screen || !screen.orientation || !screen.orientation.lock) {
        showLandscapePrompt();
        return;
    }
    screen.orientation.lock('landscape').then(function() {
        requestFullscreen();
    }).catch(function() {
        showLandscapePrompt();
    });
}

function showLandscapePrompt() {
    landscapePrompt.style.display = 'flex';
    var tapped = false;
    var timeout = setTimeout(function() {
        if (!tapped) {
            landscapePrompt.style.display = 'none';
            document.body.classList.add('landscape-fallback');
            requestFullscreen();
        }
    }, 5000);
    function onTap() {
        tapped = true;
        clearTimeout(timeout);
        landscapePrompt.removeEventListener('click', onTap);
        landscapePrompt.removeEventListener('touchstart', onTouch);
        landscapePrompt.style.display = 'none';
        document.body.classList.add('landscape-fallback');
        requestFullscreen();
    }
    function onTouch(e) {
        e.preventDefault();
        onTap();
    }
    landscapePrompt.addEventListener('click', onTap);
    landscapePrompt.addEventListener('touchstart', onTouch);
}

function requestFullscreen() {
    if (document.documentElement.requestFullscreen) {
        document.documentElement.requestFullscreen();
    } else if (document.documentElement.webkitRequestFullscreen) {
        document.documentElement.webkitRequestFullscreen();
    } else if (document.documentElement.msRequestFullscreen) {
        document.documentElement.msRequestFullscreen();
    }
}

function setupMobileControls() {
    var joystickArea = document.getElementById('joystickArea');
    var joystick = document.getElementById('joystick');
    var isDragging = false;
    var areaRect = { left: 0, top: 0, width: 150, height: 150 };

    joystickArea.style.display = 'block';

    joystickArea.addEventListener('touchstart', function(e) {
        e.preventDefault();
        isDragging = true;
        var touch = e.touches[0];
        areaRect = joystickArea.getBoundingClientRect();
        updateJoystick(touch);
    });

    joystickArea.addEventListener('touchmove', function(e) {
        e.preventDefault();
        if (!isDragging) return;
        updateJoystick(e.touches[0]);
    });

    joystickArea.addEventListener('touchend', function(e) {
        e.preventDefault();
        isDragging = false;
        joystick.style.transform = 'translate(0px, 0px)';
        mouse.x = canvas.width / 2;
        mouse.y = canvas.height / 2;
    });

    function updateJoystick(touch) {
        var dx = touch.clientX - (areaRect.left + areaRect.width / 2);
        var dy = touch.clientY - (areaRect.top + areaRect.height / 2);
        var dist = Math.sqrt(dx * dx + dy * dy);
        var maxDist = 50;
        if (dist > maxDist) {
            dx = (dx / dist) * maxDist;
            dy = (dy / dist) * maxDist;
        }
        joystick.style.transform = 'translate(' + dx + 'px, ' + dy + 'px)';
        mouse.x = canvas.width / 2 + dx * 3;
        mouse.y = canvas.height / 2 + dy * 3;
    }
}

function getColorForId(id) {
    var colors = ['#ff4444', '#44ff44', '#4444ff', '#ffff44', '#ff44ff', '#44ffff', '#ff8844', '#88ff44'];
    var hash = 0;
    for (var i = 0; i < id.length; i++) hash = id.charCodeAt(i) + ((hash << 5) - hash);
    return colors[Math.abs(hash) % colors.length];
}

window.joinLobbyByCode = joinLobbyByCode;
