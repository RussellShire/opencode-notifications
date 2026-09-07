let idleTimer = null
const IDLE_DELAY_MS = 3000

export default async ({ project, client, $, directory, worktree }) => {
    return {
        event: async ({ event }) => {
            // 1. If any non-idle activity occurs, clear the pending idle notification
            if (!(event.type === "session.status" && event.properties.status.type === "idle")) {
                if (idleTimer) {
                    clearTimeout(idleTimer)
                    idleTimer = null
                }
            }

            // 2. Handle permission prompts immediately (no delay)
            if (
                event.type === "permission.asked"
            ) {
                await $`osascript -e '
                    set prevVolume to output volume of (get volume settings)
                    set volume output volume (prevVolume * 0.3)
                    do shell script "afplay /System/Library/Sounds/{{PERM_SOUND}}.aiff"
                    delay 0.1
                    set volume output volume prevVolume
                    '`
                return
            }

            // 3. Handle session.status with debounce delay
            if (event.type === "session.status" && event.properties.status.type === "idle") {
                // Clear any existing pending timer so it resets the countdown
                if (idleTimer) {
                    clearTimeout(idleTimer)
                }

                idleTimer = setTimeout(async () => {
                    idleTimer = null // Reset timer handle

                    await $`osascript -e '
                        set prevVolume to output volume of (get volume settings)
                        set volume output volume (prevVolume * 0.3)
                        do shell script "afplay /System/Library/Sounds/{{IDLE_SOUND}}.aiff"
                        delay 0.1
                        set volume output volume prevVolume
                        '`
                }, IDLE_DELAY_MS)
            }
        },
    }
}
