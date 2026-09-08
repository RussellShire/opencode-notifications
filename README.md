# Opencode Notification Plugin (Mac)
A quick installer to add a plugin to ~/.config/opencode/plugins/ so you get notifications when you're opencode requires permissions or is ready to be prompted.

There are also pop-ups if you allow notifications the terminal where you run opencode. See Mac Settings > Notifications

## Install

Clone this repo and from the folder run:

```chmod +x install-notifications```

```$ ./install-notifications```

## Test

```npm test```

```go test ./...```

## Event Logging

- Enable: ```touch .notification-event-logging```
- Disable: ```rm .notification-event-logging```
- View: ```jq . .notification-events.jsonl```

## Build

```chmod +x build.sh```

```./build.sh```
