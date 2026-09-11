package main

import (
	"encoding/json"
	"errors"
	"io"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestWritePluginFileWritesConfiguredPlugin(t *testing.T) {
	homeDir := t.TempDir()
	setUserHomeDir(t, func() (string, error) { return homeDir, nil })

	var (
		gotPluginDir  string
		gotMkdirMode  os.FileMode
		gotPluginPath string
		gotContent    []byte
		gotWriteMode  os.FileMode
	)
	setMkdirAll(t, func(path string, mode os.FileMode) error {
		gotPluginDir = path
		gotMkdirMode = mode
		return os.MkdirAll(path, mode)
	})
	setWriteFile(t, func(path string, content []byte, mode os.FileMode) error {
		gotPluginPath = path
		gotContent = append([]byte(nil), content...)
		gotWriteMode = mode
		return os.WriteFile(path, content, mode)
	})

	if err := writePluginFile("Glass", "Funk"); err != nil {
		t.Fatalf("write plugin file: %v", err)
	}

	pluginDir := filepath.Join(homeDir, ".config", "opencode", "plugins")
	pluginPath := filepath.Join(pluginDir, "notifications.js")
	info, err := os.Stat(pluginDir)
	if err != nil {
		t.Fatalf("stat plugin directory: %v", err)
	}
	if !info.IsDir() {
		t.Fatalf("plugin directory is not a directory: %s", pluginDir)
	}
	if got, want := gotPluginDir, pluginDir; got != want {
		t.Errorf("mkdir path = %q, want %q", got, want)
	}
	if got, want := gotMkdirMode, os.FileMode(0755); got != want {
		t.Errorf("mkdir mode = %#o, want %#o", got, want)
	}
	content, err := os.ReadFile(pluginPath)
	if err != nil {
		t.Fatalf("read plugin file: %v", err)
	}
	if got, want := gotPluginPath, pluginPath; got != want {
		t.Errorf("write path = %q, want %q", got, want)
	}
	if got, want := gotWriteMode, os.FileMode(0644); got != want {
		t.Errorf("write mode = %#o, want %#o", got, want)
	}
	workingDir, err := os.Getwd()
	if err != nil {
		t.Fatalf("get working directory: %v", err)
	}
	configPath, logPath, err := diagnosticsPaths(workingDir)
	if err != nil {
		t.Fatalf("get diagnostics paths: %v", err)
	}
	wantContent := strings.ReplaceAll(pluginTemplate, "{{IDLE_SOUND}}", "Glass")
	wantContent = strings.ReplaceAll(wantContent, "{{PERM_SOUND}}", "Funk")
	wantContent = strings.ReplaceAll(wantContent, "/* {{DIAGNOSTICS_CONFIG_PATH}} */ null", configPath)
	wantContent = strings.ReplaceAll(wantContent, "/* {{DIAGNOSTICS_LOG_PATH}} */ null", logPath)
	if got := string(gotContent); got != wantContent {
		t.Errorf("written content = %q, want %q", got, wantContent)
	}
	if got := string(content); got != wantContent {
		t.Errorf("file content = %q, want %q", got, wantContent)
	}
	info, err = os.Stat(pluginPath)
	if err != nil {
		t.Fatalf("stat plugin file: %v", err)
	}
	if got, want := info.Mode().Perm(), os.FileMode(0644); got != want {
		t.Errorf("plugin mode = %#o, want %#o", got, want)
	}
}

func TestWritePluginFileWrapsFilesystemErrors(t *testing.T) {
	sentinel := errors.New("injected failure")

	tests := []struct {
		name       string
		configure  func(t *testing.T)
		wantPrefix string
	}{
		{
			name: "home directory lookup",
			configure: func(t *testing.T) {
				setUserHomeDir(t, func() (string, error) { return "", sentinel })
			},
			wantPrefix: "failed to locate home directory",
		},
		{
			name: "directory creation",
			configure: func(t *testing.T) {
				setUserHomeDir(t, func() (string, error) { return t.TempDir(), nil })
				setMkdirAll(t, func(string, os.FileMode) error { return sentinel })
			},
			wantPrefix: "failed to create directory",
		},
		{
			name: "file writing",
			configure: func(t *testing.T) {
				setUserHomeDir(t, func() (string, error) { return t.TempDir(), nil })
				setWriteFile(t, func(string, []byte, os.FileMode) error { return sentinel })
			},
			wantPrefix: "failed to write file",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tt.configure(t)

			err := writePluginFile("Glass", "Funk")
			if !errors.Is(err, sentinel) {
				t.Fatalf("error = %v, want wrapped %v", err, sentinel)
			}
			if !strings.Contains(err.Error(), tt.wantPrefix) {
				t.Errorf("error = %q, want context %q", err, tt.wantPrefix)
			}
		})
	}
}

func TestRemovePluginFileRemovesOnlyManagedPlugin(t *testing.T) {
	homeDir := t.TempDir()
	pluginDir := filepath.Join(homeDir, ".config", "opencode", "plugins")
	pluginPath := filepath.Join(pluginDir, "notifications.js")
	siblingPath := filepath.Join(pluginDir, "another-plugin.js")
	if err := os.MkdirAll(pluginDir, 0755); err != nil {
		t.Fatalf("create plugin directory: %v", err)
	}
	if err := os.WriteFile(pluginPath, []byte("managed plugin"), 0644); err != nil {
		t.Fatalf("write managed plugin: %v", err)
	}
	if err := os.WriteFile(siblingPath, []byte("sibling plugin"), 0644); err != nil {
		t.Fatalf("write sibling plugin: %v", err)
	}
	setUserHomeDir(t, func() (string, error) { return homeDir, nil })

	if err := removePluginFile(); err != nil {
		t.Fatalf("remove plugin file: %v", err)
	}

	if _, err := os.Stat(pluginPath); !errors.Is(err, os.ErrNotExist) {
		t.Errorf("managed plugin stat error = %v, want not exist", err)
	}
	if _, err := os.Stat(siblingPath); err != nil {
		t.Errorf("stat sibling plugin: %v", err)
	}
	if info, err := os.Stat(pluginDir); err != nil || !info.IsDir() {
		t.Errorf("plugin directory stat = %v, want existing directory", err)
	}
}

func TestRemovePluginFileAllowsMissingPlugin(t *testing.T) {
	setUserHomeDir(t, func() (string, error) { return t.TempDir(), nil })

	if err := removePluginFile(); err != nil {
		t.Fatalf("remove missing plugin file: %v", err)
	}
}

func TestRemovePluginFileWrapsFilesystemErrors(t *testing.T) {
	sentinel := errors.New("injected failure")

	t.Run("home directory lookup", func(t *testing.T) {
		setUserHomeDir(t, func() (string, error) { return "", sentinel })

		err := removePluginFile()
		if !errors.Is(err, sentinel) {
			t.Fatalf("error = %v, want wrapped %v", err, sentinel)
		}
		if !strings.Contains(err.Error(), "failed to locate home directory") {
			t.Errorf("error = %q, want home-directory context", err)
		}
	})

	t.Run("file removal", func(t *testing.T) {
		setUserHomeDir(t, func() (string, error) { return t.TempDir(), nil })
		setRemoveFile(t, func(string) error { return sentinel })

		err := removePluginFile()
		if !errors.Is(err, sentinel) {
			t.Fatalf("error = %v, want wrapped %v", err, sentinel)
		}
		if !strings.Contains(err.Error(), "failed to remove plugin file") {
			t.Errorf("error = %q, want removal context", err)
		}
	})
}

func TestWindowsInstallerWritesPluginWithoutSelectingSounds(t *testing.T) {
	setOperatingSystem(t, "windows")
	homeDir := t.TempDir()
	setUserHomeDir(t, func() (string, error) { return homeDir, nil })

	output := captureStdout(t, main)
	content, err := os.ReadFile(filepath.Join(homeDir, ".config", "opencode", "plugins", "notifications.js"))
	if err != nil {
		t.Fatalf("read installed plugin: %v", err)
	}
	if strings.Contains(string(content), "{{IDLE_SOUND}}") || strings.Contains(string(content), "{{PERM_SOUND}}") {
		t.Errorf("installed plugin contains unprocessed sound placeholders: %q", content)
	}
	if !strings.Contains(string(content), "System.Windows.Forms.NotifyIcon") {
		t.Errorf("installed plugin does not contain the Windows notification implementation: %q", content)
	}
	if !strings.Contains(output, "standard Windows notifications") {
		t.Errorf("installer output = %q, want standard Windows notifications completion message", output)
	}
	importPluginFile(t, filepath.Join(homeDir, ".config", "opencode", "plugins", "notifications.js"))
}

func TestLinuxInstallerWritesPluginWithoutSelectingSounds(t *testing.T) {
	setOperatingSystem(t, "linux")
	homeDir := t.TempDir()
	setUserHomeDir(t, func() (string, error) { return homeDir, nil })

	var soundPreviewed bool
	setStartCommand(t, func(string, ...string) error {
		soundPreviewed = true
		return nil
	})

	output := captureStdout(t, main)
	content, err := os.ReadFile(filepath.Join(homeDir, ".config", "opencode", "plugins", "notifications.js"))
	if err != nil {
		t.Fatalf("read installed plugin: %v", err)
	}
	if strings.Contains(string(content), "{{") {
		t.Errorf("installed plugin contains unprocessed placeholders: %q", content)
	}
	if !strings.Contains(string(content), "notify-send") {
		t.Errorf("installed plugin does not contain the Linux notification implementation: %q", content)
	}
	installedPlugin := string(content)
	for _, message := range []string{"Permission required", "Question asked", "Task completed"} {
		wantCall := `await sendNotification("` + message + `", "")`
		if !strings.Contains(installedPlugin, wantCall) {
			t.Errorf("installed plugin notification for %q does not use an empty sound: %q", message, installedPlugin)
		}
	}
	for _, macSound := range append(macIdleSounds, macPermSounds...) {
		if strings.Contains(installedPlugin, macSound) {
			t.Errorf("installed plugin retains macOS sound %q: %q", macSound, installedPlugin)
		}
	}
	if soundPreviewed {
		t.Error("installer previewed a sound")
	}
	if !strings.Contains(output, "Linux notifications") {
		t.Errorf("installer output = %q, want Linux notifications completion message", output)
	}
	importPluginFile(t, filepath.Join(homeDir, ".config", "opencode", "plugins", "notifications.js"))
}

func TestSoundOptionsUseMacSounds(t *testing.T) {
	setOperatingSystem(t, "darwin")

	idleSounds, permSounds := soundOptions()
	if got, want := idleSounds, []string{"Glass", "Ping", "Hero", "Submarine", "Purr"}; !equalStrings(got, want) {
		t.Errorf("idle sounds = %v, want %v", got, want)
	}
	if got, want := permSounds, []string{"Funk", "Basso", "Sosumi", "Blow", "Bottle"}; !equalStrings(got, want) {
		t.Errorf("permission sounds = %v, want %v", got, want)
	}
}

func TestPlaySoundUsesMacAudioPreview(t *testing.T) {
	setOperatingSystem(t, "darwin")
	var gotName string
	var gotArgs []string
	setStartCommand(t, func(name string, args ...string) error {
		gotName = name
		gotArgs = args
		return nil
	})

	playSound("Glass")

	if got, want := gotName, "afplay"; got != want {
		t.Errorf("command = %q, want %q", got, want)
	}
	if got, want := gotArgs, []string{"/System/Library/Sounds/Glass.aiff"}; !equalStrings(got, want) {
		t.Errorf("arguments = %v, want %v", got, want)
	}
}

func setUserHomeDir(t *testing.T, lookup func() (string, error)) {
	t.Helper()

	original := userHomeDir
	userHomeDir = lookup
	t.Cleanup(func() { userHomeDir = original })
}

func setMkdirAll(t *testing.T, makeDir func(string, os.FileMode) error) {
	t.Helper()

	original := mkdirAll
	mkdirAll = makeDir
	t.Cleanup(func() { mkdirAll = original })
}

func setWriteFile(t *testing.T, write func(string, []byte, os.FileMode) error) {
	t.Helper()

	original := writeFile
	writeFile = write
	t.Cleanup(func() { writeFile = original })
}

func setRemoveFile(t *testing.T, remove func(string) error) {
	t.Helper()

	original := removeFile
	removeFile = remove
	t.Cleanup(func() { removeFile = original })
}

func setOperatingSystem(t *testing.T, value string) {
	t.Helper()

	original := operatingSystem
	operatingSystem = value
	t.Cleanup(func() { operatingSystem = original })
}

func setStartCommand(t *testing.T, start func(string, ...string) error) {
	t.Helper()

	original := startCommand
	startCommand = start
	t.Cleanup(func() { startCommand = original })
}

func captureStdout(t *testing.T, run func()) string {
	t.Helper()

	previous := os.Stdout
	reader, writer, err := os.Pipe()
	if err != nil {
		t.Fatalf("create stdout pipe: %v", err)
	}
	os.Stdout = writer
	t.Cleanup(func() { os.Stdout = previous })

	run()
	if err := writer.Close(); err != nil {
		t.Fatalf("close stdout pipe: %v", err)
	}
	output, err := io.ReadAll(reader)
	if err != nil {
		t.Fatalf("read stdout pipe: %v", err)
	}
	if err := reader.Close(); err != nil {
		t.Fatalf("close stdout pipe reader: %v", err)
	}
	return string(output)
}

func equalStrings(got, want []string) bool {
	if len(got) != len(want) {
		return false
	}
	for index := range got {
		if got[index] != want[index] {
			return false
		}
	}
	return true
}

func TestPluginTemplateUsesNullDiagnosticsDefaults(t *testing.T) {
	if !strings.Contains(pluginTemplate, "const diagnosticsConfigPath = /* {{DIAGNOSTICS_CONFIG_PATH}} */ null") {
		t.Errorf("template does not provide a null config-path default: %q", pluginTemplate)
	}
	if !strings.Contains(pluginTemplate, "const diagnosticsLogPath = /* {{DIAGNOSTICS_LOG_PATH}} */ null") {
		t.Errorf("template does not provide a null log-path default: %q", pluginTemplate)
	}
}

func TestWritePluginFileInjectsDiagnosticsPathsForGitDirectory(t *testing.T) {
	tempDir := t.TempDir()
	repoRoot := filepath.Join(tempDir, "repository")
	workingDir := filepath.Join(repoRoot, "nested", "directory")
	if err := os.MkdirAll(filepath.Join(repoRoot, ".git"), 0755); err != nil {
		t.Fatalf("create git directory: %v", err)
	}
	if err := os.MkdirAll(workingDir, 0755); err != nil {
		t.Fatalf("create working directory: %v", err)
	}
	resolvedRepoRoot, err := filepath.EvalSymlinks(repoRoot)
	if err != nil {
		t.Fatalf("resolve repository root: %v", err)
	}

	setWorkingDirectory(t, workingDir)
	t.Setenv("HOME", filepath.Join(tempDir, "home"))

	if err := writePluginFile("Glass", "Funk"); err != nil {
		t.Fatalf("write plugin file: %v", err)
	}

	content := readInstalledPlugin(t)
	wantConfig := jsonString(t, filepath.Join(resolvedRepoRoot, ".notification-config.json"))
	if !strings.Contains(content, "const diagnosticsConfigPath = "+wantConfig) {
		t.Errorf("config path was not injected as a JSON string literal: %q", content)
	}
	wantLog := jsonString(t, filepath.Join(resolvedRepoRoot, ".notification-events.jsonl"))
	if !strings.Contains(content, "const diagnosticsLogPath = "+wantLog) {
		t.Errorf("log path was not injected as a JSON string literal: %q", content)
	}
}

func TestWritePluginFileInjectsJSONEncodedDiagnosticsPathsForGitWorktreeFile(t *testing.T) {
	tempDir := t.TempDir()
	repoRoot := filepath.Join(tempDir, `repository "quoted" \ path`)
	workingDir := filepath.Join(repoRoot, "nested")
	if err := os.MkdirAll(workingDir, 0755); err != nil {
		t.Fatalf("create working directory: %v", err)
	}
	if err := os.WriteFile(filepath.Join(repoRoot, ".git"), []byte("gitdir: /worktree/metadata\n"), 0644); err != nil {
		t.Fatalf("create git worktree file: %v", err)
	}
	resolvedRepoRoot, err := filepath.EvalSymlinks(repoRoot)
	if err != nil {
		t.Fatalf("resolve repository root: %v", err)
	}

	setWorkingDirectory(t, workingDir)
	t.Setenv("HOME", filepath.Join(tempDir, "home"))

	if err := writePluginFile("Glass", "Funk"); err != nil {
		t.Fatalf("write plugin file: %v", err)
	}

	content := readInstalledPlugin(t)
	wantConfig := jsonString(t, filepath.Join(resolvedRepoRoot, ".notification-config.json"))
	if !strings.Contains(content, "const diagnosticsConfigPath = "+wantConfig) {
		t.Errorf("config path was not injected as a JSON string literal: %q", content)
	}
	wantLog := jsonString(t, filepath.Join(resolvedRepoRoot, ".notification-events.jsonl"))
	if !strings.Contains(content, "const diagnosticsLogPath = "+wantLog) {
		t.Errorf("log path was not injected as a JSON string literal: %q", content)
	}
	importInstalledPlugin(t)
}

func TestWritePluginFileDisablesDiagnosticsOutsideGitRepository(t *testing.T) {
	tempDir := t.TempDir()
	workingDir := filepath.Join(tempDir, "not-a-repository", "nested")
	if err := os.MkdirAll(workingDir, 0755); err != nil {
		t.Fatalf("create working directory: %v", err)
	}

	setWorkingDirectory(t, workingDir)
	t.Setenv("HOME", filepath.Join(tempDir, "home"))

	if err := writePluginFile("Glass", "Funk"); err != nil {
		t.Fatalf("write plugin file: %v", err)
	}

	content := readInstalledPlugin(t)
	if !strings.Contains(content, "const diagnosticsConfigPath = null") {
		t.Errorf("config path did not disable diagnostics: %q", content)
	}
	if !strings.Contains(content, "const diagnosticsLogPath = null") {
		t.Errorf("log path did not disable diagnostics: %q", content)
	}
}

func TestWritePluginFileDisablesDiagnosticsForMalformedGitWorktreeFile(t *testing.T) {
	for _, gitFileContent := range []string{
		"gitdir:",
		"gitdir:relative/path",
		"gitdir:\t/worktree/metadata",
		"gitdir:\n/worktree/metadata",
		"gitdir: /worktree/metadata\nsecond-line",
		"gitdir: \n",
	} {
		t.Run(gitFileContent, func(t *testing.T) {
			tempDir := t.TempDir()
			repoRoot := filepath.Join(tempDir, "repository")
			workingDir := filepath.Join(repoRoot, "nested")
			if err := os.MkdirAll(workingDir, 0755); err != nil {
				t.Fatalf("create working directory: %v", err)
			}
			if err := os.WriteFile(filepath.Join(repoRoot, ".git"), []byte(gitFileContent), 0644); err != nil {
				t.Fatalf("create malformed git worktree file: %v", err)
			}

			setWorkingDirectory(t, workingDir)
			t.Setenv("HOME", filepath.Join(tempDir, "home"))

			if err := writePluginFile("Glass", "Funk"); err != nil {
				t.Fatalf("write plugin file: %v", err)
			}

			content := readInstalledPlugin(t)
			if !strings.Contains(content, "const diagnosticsConfigPath = null") {
				t.Errorf("config path did not disable diagnostics: %q", content)
			}
			if !strings.Contains(content, "const diagnosticsLogPath = null") {
				t.Errorf("log path did not disable diagnostics: %q", content)
			}
		})
	}
}

func TestSetLoggingAndStatusUseRepositoryLocalConfiguration(t *testing.T) {
	tempDir := t.TempDir()
	repoRoot := filepath.Join(tempDir, "repository")
	if err := os.MkdirAll(filepath.Join(repoRoot, ".git"), 0755); err != nil {
		t.Fatalf("create git directory: %v", err)
	}
	setWorkingDirectory(t, repoRoot)

	enabled, err := loggingStatus()
	if err != nil {
		t.Fatalf("get default status: %v", err)
	}
	if enabled {
		t.Error("default logging status = on, want off")
	}
	if err := setLogging(true); err != nil {
		t.Fatalf("enable logging: %v", err)
	}
	content, err := os.ReadFile(filepath.Join(repoRoot, ".notification-config.json"))
	if err != nil {
		t.Fatalf("read logging configuration: %v", err)
	}
	if got, want := string(content), "{\"logging\":true}\n"; got != want {
		t.Errorf("configuration = %q, want %q", got, want)
	}
	enabled, err = loggingStatus()
	if err != nil || !enabled {
		t.Errorf("enabled status = %t, %v; want true, nil", enabled, err)
	}
	if err := setLogging(false); err != nil {
		t.Fatalf("disable logging: %v", err)
	}
	enabled, err = loggingStatus()
	if err != nil || enabled {
		t.Errorf("disabled status = %t, %v; want false, nil", enabled, err)
	}
}

func TestSetLoggingPreservesConfiguredLineLimit(t *testing.T) {
	tempDir := t.TempDir()
	repoRoot := filepath.Join(tempDir, "repository")
	if err := os.MkdirAll(filepath.Join(repoRoot, ".git"), 0755); err != nil {
		t.Fatalf("create git directory: %v", err)
	}
	if err := os.WriteFile(filepath.Join(repoRoot, ".notification-config.json"), []byte("{\"logging\":false,\"lines\":25}\n"), 0600); err != nil {
		t.Fatalf("write notification configuration: %v", err)
	}
	setWorkingDirectory(t, repoRoot)

	if err := setLogging(true); err != nil {
		t.Fatalf("enable logging: %v", err)
	}
	content, err := os.ReadFile(filepath.Join(repoRoot, ".notification-config.json"))
	if err != nil {
		t.Fatalf("read notification configuration: %v", err)
	}
	if got, want := string(content), "{\"logging\":true,\"lines\":25}\n"; got != want {
		t.Errorf("configuration = %q, want %q", got, want)
	}
}

func TestLoggingCommandsRequireGitRepository(t *testing.T) {
	setWorkingDirectory(t, t.TempDir())
	if err := setLogging(true); err == nil {
		t.Error("enable logging outside a repository succeeded")
	}
	if _, err := loggingStatus(); err == nil {
		t.Error("status outside a repository succeeded")
	}
}

func setWorkingDirectory(t *testing.T, directory string) {
	t.Helper()

	originalDirectory, err := os.Getwd()
	if err != nil {
		t.Fatalf("get working directory: %v", err)
	}
	if err := os.Chdir(directory); err != nil {
		t.Fatalf("change working directory: %v", err)
	}
	t.Cleanup(func() {
		if err := os.Chdir(originalDirectory); err != nil {
			t.Errorf("restore working directory: %v", err)
		}
	})
}

func readInstalledPlugin(t *testing.T) string {
	t.Helper()

	homeDir, err := os.UserHomeDir()
	if err != nil {
		t.Fatalf("locate home directory: %v", err)
	}
	content, err := os.ReadFile(filepath.Join(homeDir, ".config", "opencode", "plugins", "notifications.js"))
	if err != nil {
		t.Fatalf("read installed plugin: %v", err)
	}
	return string(content)
}

func importInstalledPlugin(t *testing.T) {
	t.Helper()

	homeDir, err := os.UserHomeDir()
	if err != nil {
		t.Fatalf("locate home directory: %v", err)
	}
	if err := os.WriteFile(filepath.Join(homeDir, "package.json"), []byte(`{"type":"module"}`), 0644); err != nil {
		t.Fatalf("write module package configuration: %v", err)
	}
	pluginPath := filepath.Join(homeDir, ".config", "opencode", "plugins", "notifications.js")
	importPluginFile(t, pluginPath)
}

func importPluginFile(t *testing.T, pluginPath string) {
	t.Helper()

	pluginURL := (&url.URL{Scheme: "file", Path: pluginPath}).String()
	output, err := exec.Command("node", "--input-type=module", "--eval", "await import(process.argv[1])", pluginURL).CombinedOutput()
	if err != nil {
		t.Fatalf("import installed plugin: %v\n%s", err, output)
	}
}

func jsonString(t *testing.T, value string) string {
	t.Helper()

	encoded, err := json.Marshal(value)
	if err != nil {
		t.Fatalf("JSON encode string: %v", err)
	}
	return string(encoded)
}
