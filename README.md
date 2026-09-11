# Opencode Notification Plugin
An installer to add a plugin to `~/.config/opencode/plugins/` so you get notifications when OpenCode requires permissions or is ready for a prompt.

You may have to allow notifications for the terminal where you run opencode. On macOS, see System Settings > Notifications.

## Prerequisites

- [`just`](https://github.com/casey/just) is optional and provides the primary local commands.
- Go and Node.js/npm are development and test prerequisites only; end users do not need to run `npm install`.
- macOS build prerequisites, including `lipo`, to build installer artifacts.

## Commands

Run local commands through `just`:

```sh
just test
just test-go
just test-js
just build
just install
just uninstall
just logging enable
just logging disable
```

Available recipes are `test`, `test-go`, `test-js`, `build`, `install`, `uninstall`, and `logging <enable|disable>`.

Installer operations (`install`, `uninstall`, and `logging`) are supported on macOS, Windows, and Linux. `just` automatically selects the supported Unix or Windows architecture; without `just`, choose the command matching your platform and architecture.

## Install

```sh
just install
```

**Install Without just**


```sh
# macOS

./dist/install-notifications

# Linux x86_64/amd64

./dist/install-notifications-linux-amd64

# Linux aarch64/arm64

./dist/install-notifications-linux-arm64
```
```powershell
# Windows x64 (AMD64)

.\dist\install-notifications-windows-amd64.exe

# Windows ARM64

.\dist\install-notifications-windows-arm64.exe
```

## Uninstall

```sh
just uninstall
```

**Uninstall Without just**

```sh
# macOS

./dist/install-notifications --uninstall

# Linux x86_64/amd64

./dist/install-notifications-linux-amd64 --uninstall

# Linux aarch64/arm64

./dist/install-notifications-linux-arm64 --uninstall
```

```powershell
# Windows x64

.\dist\install-notifications-windows-amd64.exe --uninstall

# Windows ARM64

.\dist\install-notifications-windows-arm64.exe --uninstall
```

## Test

```sh
just test
```

**Without just**

```sh
go test ./...
npm test
```

## Event Logging

- Logging is disabled by default and configured per Git repository.
- Configuration is stored in `.notification-config.json` at the repository root.
- Enable logging:

  ```sh
  just logging enable
  ```

  **Without just**

  ```sh
   # macOS
   ./dist/install-notifications --logging on

   # Linux x86_64/amd64
   ./dist/install-notifications-linux-amd64 --logging on

   # Linux aarch64/arm64
   ./dist/install-notifications-linux-arm64 --logging on
  ```

  ```powershell
  # Windows x64 (AMD)
  .\dist\install-notifications-windows-amd64.exe --logging on

  # Windows ARM64
  .\dist\install-notifications-windows-arm64.exe --logging on
  ```

- Disable logging:

  ```sh
  just logging disable
  ```

  **Without just**

  ```sh
   # macOS
   ./dist/install-notifications --logging off

   # Linux x86_64/amd64
   ./dist/install-notifications-linux-amd64 --logging off

   # Linux aarch64/arm64
   ./dist/install-notifications-linux-arm64 --logging off
  ```

  ```powershell
  # Windows x64 (AMD)
  .\dist\install-notifications-windows-amd64.exe --logging off

  # Windows ARM64
  .\dist\install-notifications-windows-arm64.exe --logging off
  ```
- Set a retention limit by adding `lines` to the configuration, for example:

```json
{
  "logging": true,
  "lines": 100
}
```

- `lines` defaults to `100` when omitted or invalid.
- View: `jq . .notification-events.jsonl`

## Linux Notifications

Linux notifications invoke `notify-send`. They require a graphical desktop session with a notification service and the `notify-send` executable (provided by libnotify). Delivery is best-effort: if these prerequisites are unavailable, no notification is shown and OpenCode continues without interruption.

## Build

`just build` must run on macOS because it delegates to `build.sh`, which invokes `lipo` to create the universal macOS binary.

```sh
just build
```

**Without just** (macOS only)

```sh
chmod +x build.sh
./build.sh
```

The build outputs are:

- `dist/install-notifications` — macOS universal binary
- `dist/install-notifications-windows-amd64.exe` — Windows x64 (AMD)
- `dist/install-notifications-windows-arm64.exe` — Windows on ARM
- `dist/install-notifications-linux-amd64` — Linux x86_64/amd64
- `dist/install-notifications-linux-arm64` — Linux aarch64/arm64
