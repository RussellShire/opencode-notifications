# Opencode Notification Plugin
A quick installer to add a plugin to ~/.config/opencode/plugins/ so you get notifications when you're opencode requires permissions or is ready to be prompted.

There are also pop-ups if you allow notifications for the terminal where you run opencode. On macOS, see System Settings > Notifications.

## Prerequisites

- [`just`](https://github.com/casey/just) is optional and provides the primary local commands.
- Go and Node.js/npm are required to run the test suites.
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

Installer operations (`install`, `uninstall`, and `logging`) are supported on macOS and Windows. `just` automatically selects the supported OS and Windows architecture; without `just`, choose the command matching your platform and Windows architecture.

## Install

Download the artifact matching your operating system and CPU architecture from `dist/`, then run:

```sh
just install
```

**Without just**

```sh
# macOS
./dist/install-notifications
```

```powershell
# Windows x64
.\dist\install-notifications-windows-amd64.exe

# Windows ARM64
.\dist\install-notifications-windows-arm64.exe
```

## Uninstall

```sh
just uninstall
```

**Without just**

```sh
# macOS
./dist/install-notifications --uninstall
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
  ```

  ```powershell
  # Windows x64
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
  ```

  ```powershell
  # Windows x64
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
- `dist/install-notifications-windows-amd64.exe` — Windows x64
- `dist/install-notifications-windows-arm64.exe` — Windows on ARM
