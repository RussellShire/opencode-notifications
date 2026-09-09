package main

import (
	_ "embed"
	"encoding/json"
	"errors"
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
	idleSounds  = []string{"Glass", "Ping", "Hero", "Submarine", "Purr"}
	permSounds  = []string{"Funk", "Basso", "Sosumi", "Blow", "Bottle"}
	userHomeDir = os.UserHomeDir
	mkdirAll    = os.MkdirAll
	writeFile   = os.WriteFile
	removeFile  = os.Remove
	readFile    = os.ReadFile
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
	homeDir, err := userHomeDir()
	if err != nil {
		return fmt.Errorf("failed to locate home directory: %w", err)
	}

	pluginDir := filepath.Join(homeDir, ".config", "opencode", "plugins")
	pluginPath := filepath.Join(pluginDir, "notifications.js")

	if err := mkdirAll(pluginDir, 0755); err != nil {
		return fmt.Errorf("failed to create directory: %w", err)
	}

	workingDir, err := os.Getwd()
	if err != nil {
		return fmt.Errorf("failed to locate working directory: %w", err)
	}

	configPath, logPath, err := diagnosticsPaths(workingDir)
	if err != nil {
		return err
	}

	// Replace the placeholders with the selected sound names and diagnostics paths.
	content := strings.ReplaceAll(pluginTemplate, "{{IDLE_SOUND}}", idleSound)
	content = strings.ReplaceAll(content, "{{PERM_SOUND}}", permSound)
	content = strings.ReplaceAll(content, "/* {{DIAGNOSTICS_CONFIG_PATH}} */ null", configPath)
	content = strings.ReplaceAll(content, "/* {{DIAGNOSTICS_LOG_PATH}} */ null", logPath)

	// Write out the processed file
	if err := writeFile(pluginPath, []byte(content), 0644); err != nil {
		return fmt.Errorf("failed to write file: %w", err)
	}

	return nil
}

func removePluginFile() error {
	homeDir, err := userHomeDir()
	if err != nil {
		return fmt.Errorf("failed to locate home directory: %w", err)
	}

	pluginPath := filepath.Join(homeDir, ".config", "opencode", "plugins", "notifications.js")
	if err := removeFile(pluginPath); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("failed to remove plugin file: %w", err)
	}

	return nil
}

func diagnosticsPaths(workingDir string) (string, string, error) {
	for directory := workingDir; ; directory = filepath.Dir(directory) {
		if isGitRepositoryRoot(directory) {
			configPath, err := json.Marshal(filepath.Join(directory, ".notification-config.json"))
			if err != nil {
				return "", "", fmt.Errorf("failed to JSON encode diagnostics config path: %w", err)
			}
			logPath, err := json.Marshal(filepath.Join(directory, ".notification-events.jsonl"))
			if err != nil {
				return "", "", fmt.Errorf("failed to JSON encode diagnostics log path: %w", err)
			}
			return string(configPath), string(logPath), nil
		}

		parent := filepath.Dir(directory)
		if parent == directory {
			return "null", "null", nil
		}
	}
}

func loggingConfigPath(workingDir string) (string, error) {
	configPath, _, err := diagnosticsPaths(workingDir)
	if err != nil {
		return "", err
	}
	if configPath == "null" {
		return "", fmt.Errorf("event logging is only available inside a Git repository")
	}

	var path string
	if err := json.Unmarshal([]byte(configPath), &path); err != nil {
		return "", fmt.Errorf("failed to decode diagnostics config path: %w", err)
	}
	return path, nil
}

func setLogging(enabled bool) error {
	workingDir, err := os.Getwd()
	if err != nil {
		return fmt.Errorf("failed to locate working directory: %w", err)
	}
	configPath, err := loggingConfigPath(workingDir)
	if err != nil {
		return err
	}

	config := struct {
		Logging bool `json:"logging"`
		Lines   *int `json:"lines,omitempty"`
	}{Logging: enabled}
	content, err := readFile(configPath)
	if err == nil {
		if err := json.Unmarshal(content, &config); err != nil {
			return fmt.Errorf("failed to parse notification configuration: %w", err)
		}
		config.Logging = enabled
	} else if !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("failed to read notification configuration: %w", err)
	}

	encoded, err := json.Marshal(config)
	if err != nil {
		return fmt.Errorf("failed to encode notification configuration: %w", err)
	}
	if err := writeFile(configPath, append(encoded, '\n'), 0600); err != nil {
		return fmt.Errorf("failed to write notification configuration: %w", err)
	}
	return nil
}

func loggingStatus() (bool, error) {
	workingDir, err := os.Getwd()
	if err != nil {
		return false, fmt.Errorf("failed to locate working directory: %w", err)
	}
	configPath, err := loggingConfigPath(workingDir)
	if err != nil {
		return false, err
	}
	content, err := readFile(configPath)
	if errors.Is(err, os.ErrNotExist) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("failed to read event logging configuration: %w", err)
	}

	var config struct {
		Logging bool `json:"logging"`
	}
	if err := json.Unmarshal(content, &config); err != nil {
		return false, fmt.Errorf("failed to parse notification configuration: %w", err)
	}
	return config.Logging, nil
}

func isGitRepositoryRoot(directory string) bool {
	gitPath := filepath.Join(directory, ".git")
	info, err := os.Stat(gitPath)
	if err != nil {
		return false
	}
	if info.IsDir() {
		return true
	}
	if !info.Mode().IsRegular() {
		return false
	}

	content, err := os.ReadFile(gitPath)
	if err != nil {
		return false
	}

	worktreePath, found := strings.CutPrefix(string(content), "gitdir: ")
	if !found {
		return false
	}
	worktreePath = strings.TrimSuffix(worktreePath, "\n")
	worktreePath = strings.TrimSuffix(worktreePath, "\r")
	return worktreePath != "" && !strings.ContainsAny(worktreePath, "\r\n")
}

func main() {
	if len(os.Args) == 3 && os.Args[1] == "--logging" {
		switch os.Args[2] {
		case "on", "off":
			enabled := os.Args[2] == "on"
			if err := setLogging(enabled); err != nil {
				fmt.Println("Error updating event logging:", err)
				return
			}
			fmt.Printf("Event logging %s.\n", os.Args[2])
		case "status":
			enabled, err := loggingStatus()
			if err != nil {
				fmt.Println("Error reading event logging status:", err)
				return
			}
			if enabled {
				fmt.Println("Event logging is on.")
			} else {
				fmt.Println("Event logging is off.")
			}
		default:
			fmt.Println("Usage: install-notifications --logging on|off|status")
		}
		return
	}

	if len(os.Args) == 2 && os.Args[1] == "--uninstall" {
		if err := removePluginFile(); err != nil {
			fmt.Println("Error removing plugin file:", err)
			return
		}
		fmt.Println("Notification plugin removed.")
		return
	}

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
