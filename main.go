package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"

	"golang.org/x/term"
)

var (
	idleSounds = []string{"Glass", "Ping", "Hero", "Submarine", "Purr"}
	permSounds = []string{"Funk", "Basso", "Sosumi", "Blow", "Bottle"}
)

// Plays a macOS sound in the background without blocking execution
func playSound(soundName string) {
	soundPath := fmt.Sprintf("/System/Library/Sounds/%s.aiff", soundName)
	cmd := exec.Command("afplay", soundPath)
	_ = cmd.Start()
}

// Renders an interactive menu navigated with UP/DOWN arrow keys
func selectMenu(title string, options []string) (string, error) {
	// Put terminal into raw mode to capture individual keypresses
	oldState, err := term.MakeRaw(int(os.Stdin.Fd()))
	if err != nil {
		return "", err
	}
	defer term.Restore(int(os.Stdin.Fd()), oldState)

	selectedIndex := 0
	playSound(options[selectedIndex])

	for {
		// Clear screen below and render title
		fmt.Print("\033[H\033[2J") // Clear terminal screen
		fmt.Printf("%s (Use ARROWS to navigate, ENTER to select):\r\n\r\n", title)

		for i, option := range options {
			if i == selectedIndex {
				// Cyan highlighted selection pointer
				fmt.Printf(" \033[36m❯ %s\033[0m\r\n", option)
			} else {
				fmt.Printf("   %s\r\n", option)
			}
		}

		// Read key input
		var buf [3]byte
		n, err := os.Stdin.Read(buf[:])
		if err != nil {
			return "", err
		}

		// Check for Ctrl+C (Interrupt)
		if n == 1 && buf[0] == 3 {
			term.Restore(int(os.Stdin.Fd()), oldState)
			fmt.Println("\r\nAborted.")
			os.Exit(0)
		}

		// Handle Enter key
		if n == 1 && (buf[0] == '\r' || buf[0] == '\n') {
			return options[selectedIndex], nil
		}

		// Handle Escape sequences (Arrow keys)
		if n == 3 && buf[0] == 27 && buf[1] == 91 {
			switch buf[2] {
			case 65: // Up Arrow
				selectedIndex = (selectedIndex - 1 + len(options)) % len(options)
				playSound(options[selectedIndex])
			case 66: // Down Arrow
				selectedIndex = (selectedIndex + 1) % len(options)
				playSound(options[selectedIndex])
			}
		}
	}
}

// Helper to confirm selection
func confirmChoice(prompt string) bool {
	choice, err := selectMenu(prompt, []string{"Yes", "No"})
	if err != nil {
		return false
	}
	return choice == "Yes"
}

func main() {
	fmt.Println("--------------------------------------------------")
	fmt.Println(" 🔔 Opencode Notification Plugin Installer (Go)")
	fmt.Println("--------------------------------------------------")

	var idleSound, permSound string

	// 1. Select Idle Sound
	for {
		selected, err := selectMenu("Choose a sound for Session Completion (idle):", idleSounds)
		if err != nil {
			fmt.Println("Error reading input:", err)
			return
		}
		if confirmChoice(fmt.Sprintf("Confirm '%s' as your completion sound?", selected)) {
			idleSound = selected
			break
		}
	}

	// 2. Select Permission Sound
	for {
		selected, err := selectMenu("Choose a sound for Permission Prompts:", permSounds)
		if err != nil {
			fmt.Println("Error reading input:", err)
			return
		}
		if confirmChoice(fmt.Sprintf("Confirm '%s' as your permission sound?", selected)) {
			permSound = selected
			break
		}
	}

	// 3. Write Plugin File
	homeDir, err := os.UserHomeDir()
	if err != nil {
		fmt.Println("Failed to find home directory:", err)
		return
	}

	pluginDir := filepath.Join(homeDir, ".opencode", "plugins")
	pluginPath := filepath.Join(pluginDir, "notification.js")

	if err := os.MkdirAll(pluginDir, 0755); err != nil {
		fmt.Println("Failed to create plugin directory:", err)
		return
	}

	pluginContent := fmt.Sprintf(`export default async ({ project, client, $, directory, worktree }) => {   return {     event: async ({ event }) => {       if (event.type === "session.idle") {         await $`+"`"+`osascript -e '
          set prevVolume to output volume of (get volume settings)
          set volume output volume (prevVolume * 0.3)
          do shell script "afplay /System/Library/Sounds/%s.aiff"
		  display notification "Task completed" with title "opencode"
          delay 0.1
          set volume output volume prevVolume
        '`+"`"+`
      } else if (
        event.type === "permission.asked" ||
        event.type === "permission.requested" ||
        event.type === "permission.ask"
      ) {
        await $`+"`"+`osascript -e '
          set prevVolume to output volume of (get volume settings)
          set volume output volume (prevVolume * 0.3)
          do shell script "afplay /System/Library/Sounds/%s.aiff"
  		  display notification "Permission Required" with title "opencode"
          delay 0.1
          set volume output volume prevVolume
        '`+"`"+`
      }
    },
  }
}
`, idleSound, permSound)

	if err := os.WriteFile(pluginPath, []byte(pluginContent), 0644); err != nil {
		fmt.Println("Failed to write plugin file:", err)
		return
	}

	fmt.Print("\033[H\033[2J") // Clear terminal screen
	fmt.Println("✅ Installation Complete!")
	fmt.Printf(" • Session Idle Sound: %s\n", idleSound)
	fmt.Printf(" • Permission Sound:  %s\n", permSound)
	fmt.Printf(" • Installed to:       %s\n\n", pluginPath)
}
