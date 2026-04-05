import type {
  SpawnIsolatedTeamWorkerArgs,
  SpawnIsolatedTeamWorkerResult,
  StopIsolatedTeamWorkerArgs
} from '../../../../../shared/team-runtime-types'

export async function spawnIsolatedTeamWorker(
  args: SpawnIsolatedTeamWorkerArgs
): Promise<SpawnIsolatedTeamWorkerResult> {
  return window.api.teamWorkerSpawn(args)
}

export async function stopIsolatedTeamWorker(
  args: StopIsolatedTeamWorkerArgs
): Promise<{ success: true }> {
  return window.api.teamWorkerStop(args)
}
