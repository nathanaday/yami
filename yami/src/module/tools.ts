import type { AgentTool, ToolSet } from "../agent/types.js";
import type { YamiModule } from "./module.js";

export const TOOL_SET = "yami";

/**
 * One tool set with the tools of every module, for the agents of a vault. A tool is named
 * `<module id>_<tool name>`, so modules cannot collide. Undefined when no module has tools.
 */
export function moduleTools(modules: YamiModule[]): ToolSet | undefined {
  const withTools = modules.map((module) => ({ module, tools: module.tools() })).filter(({ tools }) => tools.length);
  const tools: AgentTool[] = withTools.flatMap(({ module, tools }) => tools.map((tool) => ({ ...tool, name: `${module.id.replaceAll("-", "_")}_${tool.name}` })));
  if (!tools.length) return undefined;
  return {
    name: TOOL_SET,
    description: `Tools of the Yami modules in this vault: ${withTools.map(({ module }) => module.name).join(", ")}.`,
    tools,
  };
}
