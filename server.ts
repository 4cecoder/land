// server.ts

import { bytesToUuid } from "https://deno.land/std@0.219.1/uuid/_common.ts";

function generateId(): string {
    return bytesToUuid(crypto.getRandomValues(new Uint8Array(16)));
}

interface BroadcastMessage {
    type: string;
    roomId?: string;
    playerId?: string;
    gameState?: {
        board: string[][];
        players: {
            id: string;
            name: string;
            color: string;
            score: number;
            position: Position;
            targetPosition: Position;
            moveStartTime: number;
        }[];
        chatMessages: string[];
    };
    winner?: {
        id: string;
        name: string;
        color: string;
        score: number;
        position: Position;
        targetPosition: Position;
        moveStartTime: number;
    };
    remaining?: number;
    action?: string;
    direction?: string;
    name?: string;
    chatMessage?: string;
    x?: number;
    y?: number;
    playerPosition?: Position;
}

interface Player {
    id: string;
    name: string;
    color: string;
    score: number;
    position: Position;
    targetPosition: Position;
    moveStartTime: number;
    socket: WebSocket;
    room: Room | null;
}

interface WebSocket extends globalThis.WebSocket {
    player?: Player;
}

interface Position {
    x: number;
    y: number;
}

interface Room {
    id: string;
    players: Map<string, Player>;
    gameState: GameState;
    duration: number;
    startTime: number;
}

interface Message {
    type: string;
    roomId?: string;
    playerId?: string;
    gameState?: GameState;
    winner?: {
        id: string;
        name: string;
        color: string;
        score: number;
        position: Position;
        targetPosition: Position;
        moveStartTime: number;
        room: Room | null;
    };
    remaining?: number;
    action?: string;
    direction?: string;
    name?: string;
    chatMessage?: string;
    x?: number;
    y?: number;
    playerPosition?: Position;
    speed?: number;
}

interface GameState {
    board: string[][];
    players: Player[];
    chatMessages: string[];
}

interface PlayerData {
    id: string;
    name: string;
    color: string;
    score: number;
    position: Position;
    targetPosition: Position;
    moveStartTime: number;
}

const rooms = new Map<string, Room>();
const boardSize = 50;
const playerSpeed = 1;
const gameInterval = 100;
const gameDuration = 3 * 60 * 1000; // 3 minutes in milliseconds
const maxPlayers = 4;
const playerMap = new Map<WebSocket, Player>();

async function handleConn(conn: Deno.Conn) {
    const httpConn = Deno.serveHttp(conn);

    for await (const e of httpConn) {
        await e.respondWith(handle(e.request));
    }
}

function handle(req: Request): Response {
    if (req.headers.get("upgrade") != "websocket") {
        return new Response("not trying to upgrade as websocket.");
    }

    // Upgrade the incoming HTTP request to a WebSocket connection
    const { socket, response } = Deno.upgradeWebSocket(req);

    // Handle WebSocket connection
    socket.onopen = () => {
        console.log("socket opened");
        // Initialize player and join room
        const player = createPlayer(socket);
        playerMap.set(socket, player); // Store the player object in the playerMap
        const room = findOrCreateRoom();
        joinRoom(player, room);
    };

    socket.onmessage = (e) => {
        console.log("socket message:", e.data);
        // Process game messages
        const message = JSON.parse(e.data) as Message;
        const player = playerMap.get(socket); // Get the player object from the playerMap
        if (player) {
            processMessage(player, message);
        }
    };

    socket.onerror = (e) => {
        console.log("socket errored:", e instanceof ErrorEvent ? e.message : "Unknown error");
    };

    socket.onclose = () => {
        console.log("socket closed");
        const player = playerMap.get(socket);
        if (player) {
            leaveRoom(player);
            playerMap.delete(socket); // Remove the player from the playerMap when the socket closes
        }
    };

    return response;
}

function createPlayer(socket: WebSocket): Player {
    return {
        id: generateId(),
        name: "",
        color: getRandomColor(),
        score: 0,
        position: getRandomPosition(),
        targetPosition: getRandomPosition(),
        moveStartTime: 0,
        socket,
        room: null,
    };
}

function findOrCreateRoom(): Room {
    for (const room of rooms.values()) {
        if (room.players.size < maxPlayers) {
            return room;
        }
    }
    return createRoom();
}

function createRoom(): Room {
    const roomId = generateId();
    const gameState: GameState = {
        board: createBoard(),
        players: [],
        chatMessages: [],
    };
    const room: Room = {
        id: roomId,
        players: new Map(),
        gameState,
        duration: gameDuration,
        startTime: 0,
    };
    rooms.set(roomId, room);
    return room;
}

function joinRoom(player: Player, room: Room) {
    player.room = room;
    room.players.set(player.id, player);

    if (room.players.size === 1) {
        startGame(room);
    } else {
        player.position = getRandomPosition();
        player.targetPosition = player.position;
        claimInitialTerritory(room, player);
        broadcastMessage(room, {
            type: "playerJoined",
            name: player.name,
        });
    }
}

function processMessage(player: Player, message: Message) {
    const room = player.room;

    if (room) {
        switch (message.type) {
            case "join":
                player.name = message.name || "";
                player.color = getRandomColor();
                console.log(`${player.name} joined the game`);
                break;

            case "move":
                updatePlayerPosition(player, message.direction || "", message.speed || 0);
                broadcastMessage(room, {
                    type: "positionUpdate",
                    playerId: player.id,
                    x: player.position.x,
                    y: player.position.y,
                });
                console.log(
                    `${player.name} moved to ${player.position.x}, ${player.position.y}`
                );
                break;
            case "stop":
                player.targetPosition = player.position;
                break;

            case "chat":
                room.gameState.chatMessages.push(
                    `${player.name}: ${message.chatMessage}`
                );
                console.log(`${player.name}: ${message.chatMessage}`);
                broadcastMessage(room, {
                    type: "chat",
                    playerId: player.id,
                    name: player.name,
                    chatMessage: message.chatMessage,
                });
                break;
        }
    }
}

function startGame(room: Room) {
    room.startTime = Date.now();

    for (const player of room.players.values()) {
        player.position = getRandomPosition();
        player.targetPosition = player.position;
        room.gameState.players.push(player);
    }

    const intervalId = setInterval(() => {
        updateGame(room);
        const remainingTime = room.duration - (Date.now() - room.startTime);
        if (remainingTime <= 0) {
            endGame(room);
            clearInterval(intervalId);
        }
        broadcastGameState(room, remainingTime);
    }, gameInterval);
}

function updateGame(room: Room) {
    const { board, players } = room.gameState;
    for (const player of players) {
        const { x, y } = player.position;
        if (isValidPosition(player.position)) {
            board[y][x] = player.color;
        }
        player.score = countPlayerSquares(board, player.color);
    }
}

function endGame(room: Room) {
    const winner = room.gameState.players.reduce(
        (maxScorePlayer, player) =>
            player.score > maxScorePlayer.score ? player : maxScorePlayer,
        room.gameState.players[0]
    );

    broadcastMessage(room, {
        type: "gameOver",
        winner,
    });

    rooms.delete(room.id);
}

function broadcastGameState(room: Room, remainingTime: number) {
    const playersData = room.gameState.players.map((player) => {
        // Destructure to exclude the 'room' and 'socket' properties
        const { room, socket, ...playerData } = player;
        return playerData;
    });

    const gameStateWithoutCircularReferences = {
        ...room.gameState,
        players: playersData, // Use the modified players array without circular references
    };

    const message = {
        type: "gameState",
        gameState: gameStateWithoutCircularReferences,
        remaining: Math.floor(remainingTime / 1000),
    };

    room.players.forEach((player) => {
        player.socket.send(JSON.stringify(message));
    });
}


function broadcastMessage(room: Room, message: Message) {
    // Create a new message object to avoid modifying the original message
    const broadcastMessage: BroadcastMessage = {
        ...message,
        gameState: message.gameState
            ? {
                ...message.gameState,
                players: message.gameState.players.map((player) => ({
                    id: player.id,
                    name: player.name,
                    color: player.color,
                    score: player.score,
                    position: player.position,
                    targetPosition: player.targetPosition,
                    moveStartTime: player.moveStartTime,
                })),
            }
            : undefined,
        winner: message.winner
            ? {
                id: message.winner.id,
                name: message.winner.name,
                color: message.winner.color,
                score: message.winner.score,
                position: message.winner.position,
                targetPosition: message.winner.targetPosition,
                moveStartTime: message.winner.moveStartTime,
            }
            : undefined,
    };

    const msgString = JSON.stringify(broadcastMessage);
    for (const player of room.players.values()) {
        player.socket.send(msgString);
    }
}

// Helper functions
function createBoard(): string[][] {
    return Array.from({ length: boardSize }, () =>
        Array(boardSize).fill("")
    );
}

function getRandomPosition(): Position {
    const side = Math.floor(Math.random() * 4);
    let x = 0;
    let y = 0;
    switch (side) {
        case 0: // Top side
            x = Math.floor(Math.random() * boardSize);
            break;
        case 1: // Right side
            x = boardSize - 1;
            y = Math.floor(Math.random() * boardSize);
            break;
        case 2: // Bottom side
            x = Math.floor(Math.random() * boardSize);
            y = boardSize - 1;
            break;
        case 3: // Left side
            y = Math.floor(Math.random() * boardSize);
            break;
    }
    return { x, y };
}

function updatePlayerPosition(player: Player, direction: string, speed: number) {
    const { targetPosition } = player;
    switch (direction) {
        case "up":
            targetPosition.y -= speed;
            break;
        case "down":
            targetPosition.y += speed;
            break;
        case "left":
            targetPosition.x -= speed;
            break;
        case "right":
            targetPosition.x += speed;
            break;
    }
    player.position = targetPosition;
}

function countPlayerSquares(board: string[][], color: string): number {
    let count = 0;
    for (const row of board) {
        for (const cell of row) {
            if (cell === color) {
                count++;
            }
        }
    }
    return count;
}

function getRandomColor(): string {
    const letters = "0123456789ABCDEF";
    let color = "#";
    for (let i = 0; i < 6; i++) {
        color += letters[Math.floor(Math.random() * 16)];
    }
    return color;
}

function formatChatMessages(messages: string[]): string {
    return messages.join("\n");
}

function leaveRoom(player: Player) {
    const room = player.room;
    if (room) {
        room.players.delete(player.id);
        player.room = null;

        if (room.players.size === 0) {
            rooms.delete(room.id);
        }
    }
}

function claimInitialTerritory(room: Room, player: Player) {
    const { board } = room.gameState;
    const { x, y } = player.position;
    const claimPositions: Position[] = [
        { x, y },
        { x: x - 1, y },
        { x: x + 1, y },
        { x, y: y - 1 },
        { x, y: y + 1 },
        { x: x - 1, y: y - 1 },
        { x: x - 1, y: y + 1 },
        { x: x + 1, y: y - 1 },
        { x: x + 1, y: y + 1 },
    ];
    for (const position of claimPositions) {
        if (isValidPosition(position)) {
            board[position.y][position.x] = player.color;
        }
    }
}

function isValidPosition(position: Position): boolean {
    const { x, y } = position;
    return x >= 0 && x < boardSize && y >= 0 && y < boardSize;
}

const listener = Deno.listen({ hostname: "localhost", port: 8080 });
console.log("Server running on localhost:8080");

for await (const conn of listener) {
    handleConn(conn).then(r => console.log(r));
}