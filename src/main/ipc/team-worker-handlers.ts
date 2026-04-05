import { BrowserWindow, ipcMain } from 'electron'
import { nanoid } from 'nanoid'
import type {
  SpawnIsolatedTeamWorkerArgs,
  SpawnIsolatedTeamWorkerResult,
  StopIsolatedTeamWorkerArgs
} from '../../shared/team-runtime-types'

const workerWindows = new Map<string, BrowserWindow>()

function buildWorkerUrl(args: SpawnIsolatedTeamWorkerArgs): string {
  const params = new URLSearchParams({
    ocWorker: 'team',
    teamName: args.teamName,
    memberId: args.memberId,
    memberName: args.memberName,
    prompt: args.prompt,
    ...(args.taskId ? { taskId: args.taskId } : {}),
    ...(args.model ? { model: args.model } : {}),
    ...(args.agentName ? { agentName: args.agentName } : {}),
    ...(args.workingFolder ? { workingFolder: args.workingFolder } : {})
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    return `${process.env['ELECTRON_RENDERER_URL']}?${params.toString()}`
  }

  return `file://${__dirname.replace(/\\/g, '/')}/../renderer/index.html?${params.toString()}`
}

export async function spawnIsolatedTeamWorker(
  args: SpawnIsolatedTeamWorkerArgs
): Promise<SpawnIsolatedTeamWorkerResult> {
  const workerId = `team-worker-${nanoid(8)}`
  const workerWindow = new BrowserWindow({
    width: 900,
    height: 700,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: require('path').join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  workerWindows.set(workerId, workerWindow)

  workerWindow.on('closed', () => {
    workerWindows.delete(workerId)
  })

  const target = buildWorkerUrl(args)
  if (process.env['ELECTRON_RENDERER_URL']) {
    await workerWindow.loadURL(target)
  } else {
    await workerWindow.loadURL(target)
  }

  return { success: true, workerId }
}

export async function stopIsolatedTeamWorker(args: StopIsolatedTeamWorkerArgs): Promise<{ success: true }> {
  const workerWindow = workerWindows.get(args.workerId)
  if (workerWindow && !workerWindow.isDestroyed()) {
    workerWindow.close()
  }
  workerWindows.delete(args.workerId)
  return { success: true }
}

export function stopAllIsolatedTeamWorkers(): void {
  for (const workerWindow of workerWindows.values()) {
    if (!workerWindow.isDestroyed()) {
      workerWindow.close()
    }
  }
  workerWindows.clear()
}

export function registerTeamWorkerHandlers(): void {
  ipcMain.handle('team-worker:spawn', async (_event, args: SpawnIsolatedTeamWorkerArgs) => {
    return spawnIsolatedTeamWorker(args)
  })

  ipcMain.handle('team-worker:stop', async (_event, args: StopIsolatedTeamWorkerArgs) => {
    return stopIsolatedTeamWorker(args)
  })
}
