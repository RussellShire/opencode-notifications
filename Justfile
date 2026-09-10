# Run all test suites.
test:
    go test ./...
    npm test

# Run Go tests.
test-go:
    go test ./...

# Run JavaScript tests.
test-js:
    npm test

# Build installer artifacts.
build:
    ./build.sh

# Install the notification plugin.
install:
    @just _installer install

# Remove the notification plugin.
uninstall:
    @just _installer uninstall

# Enable or disable event logging.
[windows]
logging action:
    @if ("{{ action }}" -eq "enable") { just _installer logging-on } elseif ("{{ action }}" -eq "disable") { just _installer logging-off } else { Write-Error "logging action must be enable or disable"; exit 1 }

[unix]
logging action:
    @case "{{ action }}" in enable) just _installer logging-on ;; disable) just _installer logging-off ;; *) printf '%s\n' "logging action must be enable or disable" >&2; exit 1 ;; esac

set windows-shell := ["powershell.exe", "-NoProfile", "-Command"]

[windows]
_installer mode:
    @$architecture = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture; $artifact = switch ($architecture) { "X64" { "dist/install-notifications-windows-amd64.exe"; break } "Arm64" { "dist/install-notifications-windows-arm64.exe"; break } default { Write-Error "Unsupported Windows architecture: $architecture"; exit 1 } }; $installerArgs = switch ("{{ mode }}") { "install" { @() } "uninstall" { @("--uninstall") } "logging-on" { @("--logging", "on") } "logging-off" { @("--logging", "off") } }; & $artifact @installerArgs

[unix]
_installer mode:
    @if [ "$(uname -s)" != Darwin ]; then printf '%s\n' "Unsupported OS: $(uname -s)" >&2; exit 1; fi; case "{{ mode }}" in install) ./dist/install-notifications ;; uninstall) ./dist/install-notifications --uninstall ;; logging-on) ./dist/install-notifications --logging on ;; logging-off) ./dist/install-notifications --logging off ;; esac
