// land/main.go
package main

import (
	"encoding/json"
	"log"
	"net/http"
	"syscall/js"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

var (
	db       *gorm.DB
	upgrader = websocket.Upgrader{
		CheckOrigin: func(r *http.Request) bool {
			return true
		},
	}
)

type Player struct {
	gorm.Model
	Name      string  `json:"name"`
	Character string  `json:"character"`
	Score     float64 `json:"score"`
	Color     string  `json:"color"`
}

func main() {
	var err error
	db, err = gorm.Open(sqlite.Open("game.db"), &gorm.Config{})
	if err != nil {
		log.Fatal("Failed to connect to database:", err)
	}

	err = db.AutoMigrate(&Player{})
	if err != nil {
		log.Fatal("Failed to auto-migrate Player model:", err)
	}

	r := gin.Default()

	r.POST("/register", registerPlayer)
	r.GET("/ws", wsHandler)
	r.StaticFile("/wasm_exec.js", "./wasm_exec.js")
	r.StaticFile("/game.wasm", "./game.wasm")
	r.StaticFile("/", "./index.html")

	if err := r.Run(":8080"); err != nil {
		log.Fatal("Failed to start server:", err)
	}
}

func registerPlayer(c *gin.Context) {
	var player Player
	if err := c.ShouldBindJSON(&player); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := db.Create(&player).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create player"})
		return
	}

	c.JSON(http.StatusOK, player)
}

func wsHandler(c *gin.Context) {
	ws, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		log.Println("Failed to upgrade connection:", err)
		return
	}
	defer ws.Close()

	var player Player
	err = ws.ReadJSON(&player)
	if err != nil {
		log.Println("Failed to read player registration:", err)
		return
	}

	// Game loop
	for {
		var message map[string]interface{}
		err := ws.ReadJSON(&message)
		if err != nil {
			log.Println("Failed to read message:", err)
			break
		}

		// Handle game logic in WebAssembly
		// ...

		// Get the updated game state from the WebAssembly module
		gameStateJSON := js.Global().Call("getGameState").String()
		var gameState map[string]interface{}
		err = json.Unmarshal([]byte(gameStateJSON), &gameState)
		if err != nil {
			log.Println("Failed to unmarshal game state:", err)
			break
		}

		// Broadcast game state to all connected clients
		if err := ws.WriteJSON(gameState); err != nil {
			log.Println("Failed to broadcast game state:", err)
			break
		}
	}
}
