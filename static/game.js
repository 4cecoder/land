// client game.js
var ws;
var playerID;
var playerElements = {};

document.addEventListener('DOMContentLoaded', function() {
    document.getElementById('startButton').addEventListener('click', startGame);
    document.getElementById('joinButton').addEventListener('click', joinGame);
    document.getElementById('playAgainButton').addEventListener('click', playAgain);
});

document.addEventListener('keydown', function(event) {
    var direction;
    switch (event.key) {
        case 'ArrowUp': case 'w': direction = 'up'; break;
        case 'ArrowLeft': case 'a': direction = 'left'; break;
        case 'ArrowDown': case 's': direction = 'down'; break;
        case 'ArrowRight': case 'd': direction = 'right'; break;
        case ' ':
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'stop' }));
            }
            return;
        default: return;
    }
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'move', direction: direction, speed: 5 }));
    }
});

function startGame() {
    ws = new WebSocket('ws://localhost:8080');
    ws.onopen = function() {
        console.log('Connection is open...');
        showNameModal();
    };
    ws.onmessage = function(e) {
        var data = JSON.parse(e.data);
        switch (data.type) {
            case 'gameState':
                updateGame(data);
                break;
            case 'positionUpdate':
                updatePlayerPosition(data.playerID, data.x, data.y);
                break;
            case 'playerJoined':
                addPlayer(data.playerID, data.name, data.color, data.x, data.y);
                break;
            case 'gameOver':
                showGameOverModal(data.winner);
                break;
            case 'chat':
                addChatMessage(data.name, data.chatMessage);
                break;
        }
    };
    ws.onclose = function() {
        console.log('Connection is closed...');
    };
    ws.onerror = function(err) {
        console.log('Error occurred: ' + err.message);
    };
}

function joinGame() {
    var playerName = document.getElementById('nameInput').value.trim();
    if (playerName !== '') {
        document.getElementById('nameModal').style.display = 'none';
        ws.send(JSON.stringify({ type: 'join', name: playerName }));
    }
}

function playAgain() {
    document.getElementById('gameOverModal').style.display = 'none';
    startGame();
}

function showNameModal() {
    document.getElementById('nameModal').style.display = 'block';
}

function showGameOverModal(winner) {
    document.getElementById('winnerName').textContent = winner.name;
    document.getElementById('winnerScore').textContent = winner.score;
    document.getElementById('gameOverModal').style.display = 'block';
}

var camera = {
    x: 0,
    y: 0,
    targetX: 0,
    targetY: 0,
    width: 800,
    height: 600,
    smoothing: 0.1,
};

function updateCamera(playerPosition) {
    camera.targetX = playerPosition.x * 50 - camera.width / 2;
    camera.targetY = playerPosition.y * 50 - camera.height / 2;
    camera.x += (camera.targetX - camera.x) * camera.smoothing;
    camera.y += (camera.targetY - camera.y) * camera.smoothing;
    var gameBoard = document.querySelector('.game-board');
    gameBoard.style.transform = 'translate(-' + camera.x + 'px, -' + camera.y + 'px)';
}

function updateGame(data) {
    updateBoard(data.gameState.board);
    updatePlayerList(data.gameState.players);
    var player = data.gameState.players.find(function(p) {
        return p.id === playerID;
    });
    if (player) {
        updateScore(player.score);
        updateCamera(data.playerPosition);
    }
    updateTimer(data.remaining);
}

function updateBoard(board) {
    var gameBoard = document.querySelector('.game-board');
    gameBoard.innerHTML = '';

    for (var y = 0; y < board.length; y++) {
        for (var x = 0; x < board[y].length; x++) {
            var square = document.createElement('div');
            square.className = 'grid-square';
            square.style.backgroundColor = board[y][x] || '#fff';
            square.style.left = x * 50 + 'px';
            square.style.top = y * 50 + 'px';
            gameBoard.appendChild(square);
        }
    }
}

function addPlayer(playerID, playerName, playerColor, x, y) {
    var playerElement = document.createElement('div');
    playerElement.className = 'player';
    playerElement.style.backgroundColor = playerColor;
    playerElement.style.gridColumnStart = x + 1;
    playerElement.style.gridRowStart = y + 1;

    var gameBoard = document.querySelector('.game-board');
    gameBoard.appendChild(playerElement);
    playerElements[playerID] = playerElement;

    var playerList = document.getElementById('playerList');
    var playerItem = document.createElement('li');
    playerItem.textContent = playerName;
    playerList.appendChild(playerItem);
}

function updatePlayerPosition(playerID, x, y) {
    var playerElement = playerElements[playerID];
    if (playerElement) {
        playerElement.style.gridColumnStart = x + 1;
        playerElement.style.gridRowStart = y + 1;
    }
}

function updatePlayerList(players) {
    var playerList = document.getElementById('playerList');
    playerList.innerHTML = '';

    players.forEach(function(player) {
        var li = document.createElement('li');
        var colorSpan = document.createElement('span');
        colorSpan.className = 'player-color';
        colorSpan.style.backgroundColor = player.color;
        li.appendChild(colorSpan);
        li.appendChild(document.createTextNode(player.name + ' - ' + player.score));
        playerList.appendChild(li);
    });
}

function updateScore(score) {
    document.getElementById('score').textContent = score;
}

function updateTimer(remainingTime) {
    document.getElementById('timer').textContent = formatTime(remainingTime);
}

function formatTime(seconds) {
    var minutes = Math.floor(seconds / 60);
    var remainingSeconds = seconds % 60;
    return minutes + ':' + (remainingSeconds < 10 ? '0' : '') + remainingSeconds;
}

function addChatMessage(playerName, chatMessage) {
    var chatMessages = document.getElementById('chatMessages');
    var messageElement = document.createElement('div');
    messageElement.textContent = playerName + ': ' + chatMessage;
    chatMessages.appendChild(messageElement);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

document.getElementById('chatInput').addEventListener('keyup', function(event) {
    if (event.key === 'Enter') {
        var chatInput = document.getElementById('chatInput');
        var message = chatInput.value.trim();
        if (message !== '') {
            console.log("Sending chat message:", message);
            ws.send(JSON.stringify({ type: 'chat', chatMessage: message }));
            chatInput.value = '';
        }
    }
});