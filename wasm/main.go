// land/wasm/main.go
package main

import (
	"encoding/json"
	"syscall/js"
)

const (
	gridSize     = 20
	canvasWidth  = 800
	canvasHeight = 600
)

var (
	gameState = make(map[string]interface{})
	players   = make(map[string]interface{})
)

func main() {
	// Register the exported functions
	js.Global().Set("updateGameState", js.FuncOf(updateGameState))
	js.Global().Set("getGameState", js.FuncOf(getGameState))
	js.Global().Set("getPlayers", js.FuncOf(getPlayers))
	js.Global().Set("setGameState", js.FuncOf(setGameState))
	js.Global().Set("movePlayer", js.FuncOf(movePlayer))

	// Keep the program running
	select {}
}

func updateGameState(this js.Value, args []js.Value) interface{} {
	// Implement the game state update logic
	for _, player := range players {
		playerData := player.(map[string]interface{})
		x := playerData["x"].(float64)
		y := playerData["y"].(float64)
		color := playerData["color"].(string)

		// Check if the player is on a claimable square
		squareX := int(x) / gridSize
		squareY := int(y) / gridSize
		squareKey := getSquareKey(squareX, squareY)

		if _, claimed := gameState[squareKey]; !claimed {
			// Claim the square
			gameState[squareKey] = color
			playerData["score"] = playerData["score"].(float64) + 1
		}
	}

	return nil
}

func getGameState(this js.Value, args []js.Value) interface{} {
	// Return the current game state as a JavaScript object
	jsonData, err := json.Marshal(gameState)
	if err != nil {
		println("Failed to marshal game state:", err.Error())
		return nil
	}

	return js.ValueOf(string(jsonData))
}

func getPlayers(this js.Value, args []js.Value) interface{} {
	// Return the list of players as a JavaScript array
	jsonData, err := json.Marshal(players)
	if err != nil {
		println("Failed to marshal players:", err.Error())
		return nil
	}

	return js.ValueOf(string(jsonData))
}

func setGameState(this js.Value, args []js.Value) interface{} {
	// Parse the game state from the JavaScript object
	gameStateJSON := args[0].String()
	err := json.Unmarshal([]byte(gameStateJSON), &gameState)
	if err != nil {
		println("Failed to unmarshal game state:", err.Error())
	}

	return nil
}

func movePlayer(this js.Value, args []js.Value) interface{} {
	// Handle player movement based on the input key
	key := args[0].String()
	playerID := args[1].String()

	player := players[playerID].(map[string]interface{})
	x := player["x"].(float64)
	y := player["y"].(float64)

	switch key {
	case "ArrowLeft", "a":
		x = max(0, x-gridSize)
	case "ArrowRight", "d":
		x = min(canvasWidth-gridSize, x+gridSize)
	case "ArrowUp", "w":
		y = max(0, y-gridSize)
	case "ArrowDown", "s":
		y = min(canvasHeight-gridSize, y+gridSize)
	}

	// Snap to grid
	x = float64(int(x/gridSize) * gridSize)
	y = float64(int(y/gridSize) * gridSize)

	player["x"] = x
	player["y"] = y

	return nil
}

func getSquareKey(x, y int) string {
	return string(x) + "," + string(y)
}

func min(a, b float64) float64 {
	if a < b {
		return a
	}
	return b
}

func max(a, b float64) float64 {
	if a > b {
		return a
	}
	return b
}
