export default async ({ project, client, $, directory, worktree }) => {
    return {
        event: async ({ event }) => {
            if (event.type === "session.idle") {
                await $`osascript -e '
          set prevVolume to output volume of (get volume settings)
          set volume output volume (prevVolume * 0.3)
          do shell script "afplay /System/Library/Sounds/{{IDLE_SOUND}}.aiff"
          delay 0.2
          set volume output volume prevVolume
        '`
            } else if (
                event.type === "permission.asked" ||
                event.type === "permission.requested" ||
                event.type === "permission.ask"
            ) {
                await $`osascript -e '
          set prevVolume to output volume of (get volume settings)
          set volume output volume (prevVolume * 0.3)
          do shell script "afplay /System/Library/Sounds/{{PERM_SOUND}}.aiff"
          delay 0.2
          set volume output volume prevVolume
        '`
            }
        },
    }
}
