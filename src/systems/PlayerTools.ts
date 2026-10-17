/** Shared active tool — cycles Mining → Weapon → Building via Q. */
export type ToolId = 'mining' | 'weapon' | 'building';

export const TOOL_ORDER: ToolId[] = ['mining', 'weapon', 'building'];

export const TOOL_LABELS: Record<ToolId, string> = {
  mining: 'Mining',
  weapon: 'Weapon',
  building: 'Building',
};

export const TOOL_RMB_HINT: Record<ToolId, string> = {
  mining: 'RMB mine',
  weapon: 'RMB attack',
  building: 'RMB place',
};

/** Persists across town ↔ cave transitions within a session. */
let activeTool: ToolId = 'weapon';

export function getActiveTool(): ToolId {
  return activeTool;
}

export function setActiveTool(tool: ToolId): void {
  activeTool = tool;
}

export function cycleTool(): ToolId {
  const i = TOOL_ORDER.indexOf(activeTool);
  activeTool = TOOL_ORDER[(i + 1) % TOOL_ORDER.length];
  return activeTool;
}

export function toolHelpLine(tool: ToolId = activeTool): string {
  return `Tool: ${TOOL_LABELS[tool]}  ·  Q cycle  ·  E pick up  ·  ${TOOL_RMB_HINT[tool]}`;
}
