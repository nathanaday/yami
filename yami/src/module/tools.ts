import type { AgentTool, ToolSet } from "../agent/types.js";
import type { Host, Module } from "./module.js";

export const TOOL_SET = "yami";

/**
 * One tool set with the tools of every module, for the agents of a vault. A tool is named
 * `<module id>_<tool name>`, so modules cannot collide. Undefined when no module has tools.
 */
export function moduleTools(host: Host, modules: Module[]): ToolSet | undefined {
  const tools: AgentTool[] = modules.flatMap((module) =>
    (module.tools?.({ ...host, module }) ?? []).map((tool) => ({ ...tool, name: `${module.id.replaceAll("-", "_")}_${tool.name}` })),
  );
  if (!tools.length) return undefined;
  return {
    name: TOOL_SET,
    description: `Tools of the Yami modules in this vault: ${modules.filter((m) => m.tools).map((m) => m.name).join(", ")}.`,
    tools,
  };
}
