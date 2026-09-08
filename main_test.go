package main

import (
	"encoding/json"
	"errors"
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
	markerPath, logPath, err := diagnosticsPaths(workingDir)
	if err != nil {
		t.Fatalf("get diagnostics paths: %v", err)
	}
	wantContent := strings.ReplaceAll(pluginTemplate, "{{IDLE_SOUND}}", "Glass")
	wantContent = strings.ReplaceAll(wantContent, "{{PERM_SOUND}}", "Funk")
	wantContent = strings.ReplaceAll(wantContent, "/* {{DIAGNOSTICS_MARKER_PATH}} */ null", markerPath)
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

func TestPluginTemplateUsesNullDiagnosticsDefaults(t *testing.T) {
	if !strings.Contains(pluginTemplate, "const diagnosticsMarkerPath = /* {{DIAGNOSTICS_MARKER_PATH}} */ null") {
		t.Errorf("template does not provide a null marker-path default: %q", pluginTemplate)
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
	wantMarker := jsonString(t, filepath.Join(resolvedRepoRoot, ".notification-event-logging"))
	if !strings.Contains(content, "const diagnosticsMarkerPath = "+wantMarker) {
		t.Errorf("marker path was not injected as a JSON string literal: %q", content)
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
	wantMarker := jsonString(t, filepath.Join(resolvedRepoRoot, ".notification-event-logging"))
	if !strings.Contains(content, "const diagnosticsMarkerPath = "+wantMarker) {
		t.Errorf("marker path was not injected as a JSON string literal: %q", content)
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
	if !strings.Contains(content, "const diagnosticsMarkerPath = null") {
		t.Errorf("marker path did not disable diagnostics: %q", content)
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
			if !strings.Contains(content, "const diagnosticsMarkerPath = null") {
				t.Errorf("marker path did not disable diagnostics: %q", content)
			}
			if !strings.Contains(content, "const diagnosticsLogPath = null") {
				t.Errorf("log path did not disable diagnostics: %q", content)
			}
		})
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
