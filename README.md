# Opencode Notification Plugin
A quick installer to add a plugin to ~/.config/opencode/plugins/ so you get notifications when you're opencode requires permissions or is ready to be prompted.

There are also pop-ups if you allow notifications for the terminal where you run opencode. On macOS, see System Settings > Notifications.

## Install

Download the artifact matching your operating system and CPU architecture from `dist/`.

### macOS

Use the universal macOS binary:

```sh
chmod +x dist/install-notifications
./dist/install-notifications
```

### Windows

#### Windows x64

```powershell
.\dist\install-notifications-windows-amd64.exe
```

#### Windows on ARM

```powershell
.\dist\install-notifications-windows-arm64.exe
```

## Uninstall

### macOS

```sh
./dist/install-notifications --uninstall
```

### Windows

In PowerShell, use the executable that matches your installation:

```powershell
.\dist\install-notifications-windows-amd64.exe --uninstall
```

## Test

```sh
npm test
```

```sh
go test ./...
```

## Event Logging

- Logging is disabled by default and configured per Git repository.
- Configuration is stored in `.notification-config.json` at the repository root.
- macOS: `./dist/install-notifications --logging <on|off|status>`
- Windows (PowerShell): `.\dist\install-notifications-windows-amd64.exe --logging <on|off|status>`
- On Windows on ARM, replace `windows-amd64.exe` with `windows-arm64.exe`.
- Set a retention limit by adding `lines` to the configuration, for example:

```json
{
  "logging": true,
  "lines": 100
}
```

- `lines` defaults to `100` when omitted or invalid.
- View: `jq . .notification-events.jsonl`

## Build

`build.sh` must run on macOS because it invokes `lipo` to create the universal macOS binary.

```sh
chmod +x build.sh
./build.sh
```

The build outputs are:

- `dist/install-notifications` — macOS universal binary
- `dist/install-notifications-windows-amd64.exe` — Windows x64
- `dist/install-notifications-windows-arm64.exe` — Windows on ARM
