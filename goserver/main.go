package main

import (
	"encoding/json"
	"log"
	"math/rand"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
)

const (
	boardSize    = 40
	playerSpeed  = 1
	gameInterval = 100 * time.Millisecond
	gameDuration = 3 * time.Minute
	maxPlayers   = 4
)

type Player struct {
	ID             string          `json:"id"`
	Name           string          `json:"name"`
	Color          string          `json:"color"`
	Score          int             `json:"score"`
	Position       Position        `json:"position"`
	TargetPosition Position        `json:"targetPosition"`
	MoveStartTime  time.Time       `json:"moveStartTime"`
	Conn           *websocket.Conn `json:"-"`
	Room           *Room           `json:"-"`
}

type Position struct {
	X int `json:"x"`
	Y int `json:"y"`
}

type Room struct {
	ID        string
	Players   map[string]*Player
	GameState *GameState
	Duration  time.Duration
	StartTime time.Time
	Mutex     sync.Mutex
}

type Message struct {
	Type        string     `json:"type"`
	RoomID      string     `json:"roomID"`
	PlayerID    string     `json:"playerID"`
	GameState   *GameState `json:"gameState"`
	Winner      *Player    `json:"winner"`
	Remaining   int        `json:"remaining"`
	Action      string     `json:"action"`
	Direction   string     `json:"direction"`
	Name        string     `json:"name"`
	ChatMessage string     `json:"message"`
	X           int        `json:"x"`
	Y           int        `json:"y"`
}

type GameState struct {
	Board        [][]string `json:"board"`
	Players      []*Player  `json:"players"`
	ChatMessages []string   `json:"chatMessages"`
}

var rooms = make(map[string]*Room)
var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
}

func main() {
	router := gin.Default()

	router.GET("/ws", wsHandler)

	if err := router.Run(":8080"); err != nil {
		log.Fatal("Failed to start server:", err)
	}
}

func wsHandler(c *gin.Context) {
	conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		log.Printf("Failed to upgrade to websocket: %v", err)
		return
	}
	defer func(conn *websocket.Conn) {
		err := conn.Close()
		if err != nil {
			log.Printf("Error closing connection: %v", err)
		} else {
			log.Println("Connection closed successfully")
		}
	}(conn)

	player := createPlayer(conn)
	room := findOrCreateRoom()
	joinRoom(player, room)

	defer removePlayer(player, room) // Add this line

	sendInitialState(player)

	for {
		_, message, err := conn.ReadMessage()
		if err != nil {
			log.Printf("Error reading message: %v", err)
			return // Return from the function when an error occurs
		}
		processMessage(player, message)
	}
}

func removePlayer(player *Player, room *Room) {
	room.Mutex.Lock()
	defer room.Mutex.Unlock()

	delete(room.Players, player.ID)
	player.Room = nil

	if len(room.Players) == 0 {
		delete(rooms, room.ID)
	}

	log.Printf("Player %s removed from room %s", player.ID, room.ID)
}

func createPlayer(conn *websocket.Conn) *Player {
	return &Player{
		ID:       generatePlayerID(),
		Conn:     conn,
		Color:    getRandomColor(),
		Position: getRandomPosition(),
	}
}

func findOrCreateRoom() *Room {
	for _, room := range rooms {
		if len(room.Players) < maxPlayers {
			return room
		}
	}
	return createRoom()
}

func createRoom() *Room {
	roomID := generateRoomID()
	gameState := &GameState{
		Board:   createBoard(),
		Players: make([]*Player, 0),
	}
	room := &Room{
		ID:        roomID,
		Players:   make(map[string]*Player),
		GameState: gameState,
		Duration:  gameDuration,
	}
	rooms[roomID] = room
	return room
}

func joinRoom(player *Player, room *Room) {
	room.Mutex.Lock()
	defer room.Mutex.Unlock()

	player.Room = room
	room.Players[player.ID] = player

	if len(room.Players) == 1 {
		go startGame(room)
	} else {
		player.Position = getRandomPosition()
		player.TargetPosition = player.Position
		broadcastMessage(room, Message{
			Type: "playerJoined",
			Name: player.Name,
		})
	}
}

func leaveRoom(player *Player) {
	room := player.Room
	if room == nil {
		return
	}

	room.Mutex.Lock()
	defer room.Mutex.Unlock()

	delete(room.Players, player.ID)
	player.Room = nil

	if len(room.Players) == 0 {
		delete(rooms, room.ID)
	}
}

func processMessage(player *Player, message []byte) {
	var msg Message
	if err := json.Unmarshal(message, &msg); err != nil {
		log.Printf("Error unmarshalling message: %v", err)
		return
	}

	room := player.Room

	switch msg.Type {
	case "join":
		player.Name = msg.Name
		player.Color = getRandomColor()
		log.Printf("%s joined the game", player.Name)

	case "move":
		updatePlayerPosition(player, msg.Direction)
		broadcastMessage(room, Message{
			Type:     "positionUpdate",
			PlayerID: player.ID,
			X:        player.Position.X,
			Y:        player.Position.Y,
		})
		log.Printf("%s moved to %d, %d", player.Name, player.Position.X, player.Position.Y)

	case "chat":
		room.GameState.ChatMessages = append(room.GameState.ChatMessages, player.Name+": "+msg.ChatMessage)
		log.Printf("%s: %s", player.Name, msg.ChatMessage)
		broadcastMessage(room, Message{
			Type:        "chat",
			PlayerID:    player.ID,
			Name:        player.Name,
			ChatMessage: msg.ChatMessage,
		})

	}
}

func startGame(room *Room) {
	room.Mutex.Lock()
	defer room.Mutex.Unlock()

	room.StartTime = time.Now()

	for _, player := range room.Players {
		player.Position = getRandomPosition()
		player.TargetPosition = player.Position
		room.GameState.Players = append(room.GameState.Players, player)
	}

	ticker := time.NewTicker(gameInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			room.Mutex.Lock()
			updateGame(room)
			remainingTime := room.Duration - time.Since(room.StartTime)
			if remainingTime <= 0 {
				endGame(room)
				room.Mutex.Unlock()
				return
			}
			broadcastGameState(room, remainingTime)
			room.Mutex.Unlock()
		}
	}
}

func updateGame(room *Room) {
	for _, player := range room.Players {
		player.Score = countPlayerSquares(room.GameState.Board, player.Color)
	}
}

func endGame(room *Room) {
	var winner *Player
	maxScore := 0

	for _, player := range room.Players {
		if player.Score > maxScore {
			maxScore = player.Score
			winner = player
		}
	}

	broadcastMessage(room, Message{
		Type:   "gameOver",
		Winner: winner,
	})

	delete(rooms, room.ID)
}

func broadcastGameState(room *Room, remainingTime time.Duration) {
	chatMessages := formatChatMessages(room.GameState.ChatMessages)
	msg := Message{
		Type:        "gameState",
		GameState:   room.GameState,
		Remaining:   int(remainingTime.Seconds()),
		ChatMessage: chatMessages,
	}
	broadcastMessage(room, msg)
}

func sendInitialState(player *Player) {
	room := player.Room
	msg := Message{
		Type:      "gameState",
		GameState: room.GameState,
		Remaining: int(room.Duration.Seconds()),
	}
	sendMessage(player, msg)
}

func broadcastMessage(room *Room, msg Message) {
	for _, player := range room.Players {
		sendMessage(player, msg)
	}
}

func sendMessage(player *Player, msg Message) {
	player.Conn.WriteJSON(msg)
}

// Helper functions
func createBoard() [][]string {
	board := make([][]string, boardSize)
	for i := range board {
		board[i] = make([]string, boardSize)
	}
	return board
}

func getRandomPosition() Position {
	x := rand.Intn(boardSize)
	y := rand.Intn(boardSize)
	return Position{X: x, Y: y}
}

func updatePlayerPosition(player *Player, direction string) {
	switch direction {
	case "up":
		player.TargetPosition.Y -= playerSpeed
	case "down":
		player.TargetPosition.Y += playerSpeed
	case "left":
		player.TargetPosition.X -= playerSpeed
	case "right":
		player.TargetPosition.X += playerSpeed
	}
	player.Position = player.TargetPosition
}

func countPlayerSquares(board [][]string, color string) int {
	count := 0
	for _, row := range board {
		for _, cell := range row {
			if cell == color {
				count++
			}
		}
	}
	return count
}

func generatePlayerID() string {
	return generateRandomString(8)
}

func generateRoomID() string {
	return generateRandomString(6)
}

func generateRandomString(length int) string {
	const charset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
	b := make([]byte, length)
	for i := range b {
		b[i] = charset[rand.Intn(len(charset))]
	}
	return string(b)
}

func getRandomColor() string {
	colors := []string{"#f44336", "#e91e63", "#9c27b0", "#673ab7", "#3f51b5", "#2196f3", "#03a9f4", "#00bcd4", "#009688", "#4caf50", "#8bc34a", "#cddc39", "#ffeb3b", "#ffc107", "#ff9800", "#ff5722"}
	return colors[rand.Intn(len(colors))]
}

func formatChatMessages(messages []string) string {
	return strings.Join(messages, "\n")
}
