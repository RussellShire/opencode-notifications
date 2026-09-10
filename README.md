# Opencode Notification Plugin
A quick installer to add a plugin to ~/.config/opencode/plugins/ so you get notifications when you're opencode requires permissions or is ready to be prompted.

There are also pop-ups if you allow notifications for the terminal where you run opencode. On macOS, see System Settings > Notifications.

## Prerequisites

- [`just`](https://github.com/casey/just) for local commands.
- Go and Node.js/npm to run the test suites.
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

Installer operations (`install`, `uninstall`, and `logging`) are supported on macOS and Windows through `just`. On Windows, `just` selects the appropriate prebuilt executable for the system architecture.

## Install

Download the artifact matching your operating system and CPU architecture from `dist/`, then run:

```sh
just install
```

## Uninstall

```sh
just uninstall
```

## Test

```sh
just test
```

## Event Logging

- Logging is disabled by default and configured per Git repository.
- Configuration is stored in `.notification-config.json` at the repository root.
- Enable logging: `just logging enable`
- Disable logging: `just logging disable`
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

The build outputs are:

- `dist/install-notifications` — macOS universal binary
- `dist/install-notifications-windows-amd64.exe` — Windows x64
- `dist/install-notifications-windows-arm64.exe` — Windows on ARM
