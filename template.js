import { readFile, rename, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const isMissingFile = (error) => error?.code === 'ENOENT'
const defaultDiagnosticLines = 100

const diagnosticFileSystem = {
    readConfig: async (configPath) => {
        try {
            return await readFile(configPath, 'utf8')
        } catch (error) {
            if (isMissingFile(error)) return ''
            throw error
        }
    },
    readLog: async (logPath) => {
        try {
            return await readFile(logPath, 'utf8')
        } catch (error) {
            if (isMissingFile(error)) return ''
            throw error
        }
    },
    rewriteLog: async (logPath, contents, mode) => {
        const temporaryLogPath = `${logPath}.${randomUUID()}.tmp`
        await writeFile(temporaryLogPath, contents, { mode })
        await rename(temporaryLogPath, logPath)
    },
}

const validRecords = (log) =>
    log
        .split('\n')
        .flatMap((line) => {
            try {
                return line ? [JSON.parse(line)] : []
            } catch {
                return []
            }
        })

export default async ({ project, client, $, directory, worktree, diagnostics = {}, runAppleScript: injectedRunAppleScript, runPowerShell: injectedRunPowerShell, platform = process.platform }) => {
    const runningSessionIds = []
    const diagnosticsConfigPath = /* {{DIAGNOSTICS_CONFIG_PATH}} */ null
    const diagnosticsLogPath = /* {{DIAGNOSTICS_LOG_PATH}} */ null
    const configPath = diagnostics.configPath ?? diagnosticsConfigPath
    const logPath = diagnostics.logPath ?? diagnosticsLogPath
    const fileSystem = diagnostics.fileSystem ?? diagnosticFileSystem
    let diagnosticQueue = Promise.resolve()

    const writeDiagnosticRecord = async (record) => {
        if (!configPath || !logPath) return

        let lines = defaultDiagnosticLines
        try {
            const config = JSON.parse(await fileSystem.readConfig(configPath))
            if (config?.logging !== true) return
            lines = Number.isSafeInteger(config.lines) && config.lines > 0
                ? config.lines
                : defaultDiagnosticLines
        } catch (error) {
            if (isMissingFile(error) || error instanceof SyntaxError) return
            throw error
        }

        let log = ''
        try {
            log = await fileSystem.readLog(logPath)
        } catch (error) {
            if (!isMissingFile(error)) throw error
        }

        const records = validRecords(log)
        records.push({ timestamp: new Date().toISOString(), ...record })
        await fileSystem.rewriteLog(
            logPath,
            `${records.slice(-lines).map(JSON.stringify).join('\n')}\n`,
            0o600,
        )
    }

    const enqueueDiagnosticRecord = (record) => {
        diagnosticQueue = diagnosticQueue
            .then(() => writeDiagnosticRecord(record))
            .catch((error) => console.error('Failed to log notification event:', error))
        return diagnosticQueue
    }

    const enqueueDiagnosticEvent = (event) => enqueueDiagnosticRecord({ event })
    const writeToLog = (data) => enqueueDiagnosticRecord({ data })

    const defaultRunAppleScript = async (script) => {
        const { stdout } = await execFileAsync('osascript', ['-e', script]);
        return stdout.trim();
    };
    const runAppleScript = injectedRunAppleScript ?? defaultRunAppleScript

    const defaultRunPowerShell = async (script) => {
        const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script])
        return stdout.trim()
    }
    const runPowerShell = injectedRunPowerShell ?? defaultRunPowerShell

    const windowsSoundUri = (soundName) =>
        soundName === 'Ping' || soundName === 'Pop' || soundName === 'Mail'
            ? 'ms-winsoundevent:Notification.Mail'
            : soundName === 'Sosumi' || soundName === 'Submarine' || soundName === 'Reminder'
                ? 'ms-winsoundevent:Notification.Reminder'
                : 'ms-winsoundevent:Notification.Default'

    const sendWindowsNotification = async (message, soundName) => {
//         const encodedMessage = Buffer.from(message, 'utf8').toString('base64')
//         const toastXml = `<toast><visual><binding template="ToastGeneric"><text>OpenCode</text><text></text></binding></visual><audio src="${windowsSoundUri(soundName)}"/></toast>`
//         await runPowerShell(`[void][Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]
// [void][Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom, ContentType = WindowsRuntime]
// $toastXml = New-Object Windows.Data.Xml.Dom.XmlDocument
// $toastXml.LoadXml('${toastXml}')
// $toastXml.SelectSingleNode('//text[2]').InnerText = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${encodedMessage}'))
// $toast = [Windows.UI.Notifications.ToastNotification]::new($toastXml)
// [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier().Show($toast)`)
        await runPowerShell(`Add-Type -AssemblyName System.Windows.Forms
$Notification = New-Object System.Windows.Forms.NotifyIcon
$Notification.Icon = [System.Drawing.SystemIcons]::Information
$Notification.BalloonTipIcon = "OpenCode"
$Notification.BalloonTipText = "${message}"
$Notification.Visible = $true

[System.Media.SystemSounds]::${soundName}.Play()

$Notification.ShowBalloonTip(10000)`)
    }

    const sendMacNotification = async (message, soundName) => {
        const rawMaster = await runAppleScript('output volume of (get volume settings)');
        const rawAlert = await runAppleScript('alert volume of (get volume settings)');

        const originalMaster = parseInt(rawMaster, 10) || 50;
        const originalAlert = parseInt(rawAlert, 10) || 50;

        const duckedVol = Math.max(10, Math.floor(originalMaster * 0.4));

        await runAppleScript(`set volume output volume ${duckedVol} alert volume 100`);

        try {
            await runAppleScript('delay 0.1')
            await runAppleScript(`display notification "${message}" with title "OpenCode" sound name "${soundName}"`)
            await runAppleScript('delay 0.1')
        } finally {
            await runAppleScript(`set volume output volume ${originalMaster} alert volume ${originalAlert}`)
        }
    }

    const sendNotification = async (message, soundName) => {
        if (platform === 'win32') {
            await sendWindowsNotification(message, soundName)
            return
        }
        if (platform === 'darwin') {
            await sendMacNotification(message, soundName)
            return
        }

        return
    }

    return {
        event: async (payload) => {
            const { event } = payload ?? {}
            if (!event) return

            if (!event.type?.startsWith('message.part.')) {
                enqueueDiagnosticEvent(event)
            }

            const parentID = event.properties?.parentID ?? event.properties?.parentId
            const sessionID =
                event.properties?.sessionID ??
                event.properties?.sessionId ??
                event.properties?.id

            // Record new session Ids
            if (event.type?.startsWith('session.') && !runningSessionIds.includes(sessionID)) {
                runningSessionIds.push(sessionID)
                await writeToLog([...runningSessionIds])
            }

            if (event.type === "permission.asked" && !parentID) {
                await sendNotification("Permission required", "{{PERM_SOUND}}")
                return
            }

            if (event.type === "question.asked" && !parentID) {
                await sendNotification("Question asked", "{{PERM_SOUND}}")
                return
            }

            const isIdle =
                event.type === "session.idle" ||
                (event.type === "session.status" && event.properties?.status?.type === "idle")

            if (!isIdle) return
            await writeToLog([...runningSessionIds])

            // Remove idle session ids if they're a child session
            if (sessionID && parentID) {
                runningSessionIds.splice(runningSessionIds.indexOf(sessionID), 1)
                await writeToLog([...runningSessionIds])
            }

            await writeToLog([...runningSessionIds])

            // If there is more than one session then we can assume a child is running
            if (runningSessionIds.length > 1) return

            await sendNotification("Task completed", "{{IDLE_SOUND}}")
            runningSessionIds.splice(runningSessionIds.indexOf(sessionID), 1)
        },
    }
}
