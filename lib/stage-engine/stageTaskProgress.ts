import { taskProgress } from '@/lib/tasks/types'

/**
 * Checklist progress for a stage-engine task. Stage tasks are ordinary `tasks`
 * rows now, so this delegates to the shared helper.
 */
export const stageTaskProgress = taskProgress
