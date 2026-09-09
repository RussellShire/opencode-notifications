# Opencode Notification Plugin (Mac)
A quick installer to add a plugin to ~/.config/opencode/plugins/ so you get notifications when you're opencode requires permissions or is ready to be prompted.

There are also pop-ups if you allow notifications the terminal where you run opencode. See Mac Settings > Notifications

## Install

Clone this repo and from the folder run:

```chmod +x install-notifications```

```$ ./install-notifications```

## Uninstall

```./install-notifications --uninstall```

## Test

```npm test```

```go test ./...```

## Event Logging

- Logging is disabled by default and configured per Git repository.
- Configuration is stored in `.notification-config.json` at the repository root.
- Enable: ```./install-notifications --logging on```
- Disable: ```./install-notifications --logging off```
- Status: ```./install-notifications --logging status```
- Set a retention limit by adding `lines` to the configuration, for example:

```json
{
  "logging": true,
  "lines": 100
}
```

- `lines` defaults to `100` when omitted or invalid.
- View: ```jq . .notification-events.jsonl```

## Build

```chmod +x build.sh```

```./build.sh```
