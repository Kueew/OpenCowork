import type { ToolDefinition } from '../../api/types'
import type { SubAgentDefinition } from './types'

const DEFAULT_SUB_AGENT_TOOLS = ['Read', 'Glob', 'Grep', 'LS', 'Skill']

export interface ResolvedSubAgentTools {
  tools: ToolDefinition[]
  invalidTools: string[]
}

export function resolveSubAgentTools(
  definition: Pick<SubAgentDefinition, 'tools' | 'disallowedTools'>,
  allTools: ToolDefinition[]
): ResolvedSubAgentTools {
  const requestedTools = definition.tools.length > 0 ? definition.tools : DEFAULT_SUB_AGENT_TOOLS
  const requestedSet = new Set(requestedTools)
  const disallowedSet = new Set(definition.disallowedTools)
  const allowAll = requestedSet.has('*')

  const availableNames = new Set(allTools.map((tool) => tool.name))
  const invalidTools = requestedTools.filter(
    (toolName) => toolName !== '*' && !availableNames.has(toolName)
  )

  const resolved = allTools.filter((tool) => {
    if (disallowedSet.has(tool.name)) return false
    if (allowAll) return true
    return requestedSet.has(tool.name)
  })

  if (!disallowedSet.has('Skill') && !resolved.some((tool) => tool.name === 'Skill')) {
    const skillTool = allTools.find((tool) => tool.name === 'Skill')
    if (skillTool && (allowAll || requestedSet.has('Skill'))) {
      resolved.push(skillTool)
    }
  }

  return {
    tools: resolved,
    invalidTools
  }
}
