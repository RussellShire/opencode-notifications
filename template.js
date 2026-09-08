export default async ({ project, client, $, directory, worktree }) => {
    return {
        event: async ({event}) => {
            if (event.type === "permission.asked") {
                await $`osascript -e 'display notification "Permission required" with title "OpenCode" sound name "{{PERM_SOUND}}"'`
                return
            }

            if (event.type === "session.idle" || (event.type === "session.status" && event.properties.status.type === "idle")) {
                await $`osascript -e 'display notification "Task completed" with title "OpenCode" sound name "{{IDLE_SOUND}}"'`
            }
        },
    }
}
