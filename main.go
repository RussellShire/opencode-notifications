package main

import (
	_ "embed"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"golang.org/x/term"
)

//go:embed template.js
var pluginTemplate string

var (
	idleSounds = []string{"Glass", "Ping", "Hero", "Submarine", "Purr"}
	permSounds = []string{"Funk", "Basso", "Sosumi", "Blow", "Bottle"}
)

func playSound(soundName string) {
	soundPath := fmt.Sprintf("/System/Library/Sounds/%s.aiff", soundName)
	cmd := exec.Command("afplay", soundPath)
	_ = cmd.Start()
}

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

func confirmChoice(prompt string) bool {
	choice, err := selectMenu(prompt, []string{"Yes", "No"})
	if err != nil {
		return false
	}
	return choice == "Yes"
}

func writePluginFile(idleSound, permSound string) error {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return fmt.Errorf("failed to locate home directory: %w", err)
	}

	pluginDir := filepath.Join(homeDir, ".opencode", "plugins")
	pluginPath := filepath.Join(pluginDir, "notifications.js")

	if err := os.MkdirAll(pluginDir, 0755); err != nil {
		return fmt.Errorf("failed to create directory: %w", err)
	}

	// Replace the placeholders with the selected sound names
	content := strings.ReplaceAll(pluginTemplate, "{{IDLE_SOUND}}", idleSound)
	content = strings.ReplaceAll(content, "{{PERM_SOUND}}", permSound)

	// Write out the processed file
	if err := os.WriteFile(pluginPath, []byte(content), 0644); err != nil {
		return fmt.Errorf("failed to write file: %w", err)
	}

	return nil
}

func main() {
	fmt.Println("--------------------------------------------------")
	fmt.Println(" 🔔 Opencode Notification Plugin Installer (Go)")
	fmt.Println("--------------------------------------------------")

	var idleSound, permSound string

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

	err := writePluginFile(idleSound, permSound)
	if err != nil {
		fmt.Println("Error writing file:", err)
	}

	fmt.Print("\033[H\033[2J") // Clear terminal screen
	fmt.Println("✅ Installation Complete!")
	fmt.Printf(" • Session Idle Sound: %s\n", idleSound)
	fmt.Printf(" • Permission Sound:  %s\n", permSound)
}
