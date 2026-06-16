import type { JsonRecord } from "../types";
import type { BuilderContext } from "./builderAgent";

export function builderProviderTools(): JsonRecord[] {
  return [
    { type: "agent_toolset", configs: { enabled: false } },
    {
      type: "custom",
      name: "draft_agent_config",
      description: "Create or revise a Maple managed-agent configuration draft. Use this only after the user has described an agent goal.",
      input_schema: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "The complete agent requirement, including any refinements from the conversation." }
        },
        required: ["prompt"]
      }
    },
    {
      type: "custom",
      name: "list_environments",
      description: "List reusable runtime environments in the current workspace.",
      input_schema: { type: "object", properties: {} }
    },
    {
      type: "custom",
      name: "create_agent",
      description: "Create an agent from the latest draft after explicit user confirmation.",
      input_schema: {
        type: "object",
        properties: {
          confirmed: { type: "boolean", description: "Must be true only when the user explicitly confirmed creation." },
          draft: { type: "object", description: "Optional complete AgentConfig. Omit to use the latest draft card." }
        },
        required: ["confirmed"]
      }
    },
    {
      type: "custom",
      name: "create_environment",
      description: "Create an E2B runtime environment after the agent draft or agent is ready.",
      input_schema: {
        type: "object",
        properties: {
          name: { type: "string" },
          slug: { type: "string" },
          networking: { type: "string", enum: ["unrestricted", "none"] }
        }
      }
    }
  ];
}

export function builderSystemPrompt(context: BuilderContext) {
  return [
    "You are Maple Agent Builder, a control-plane assistant inside Maple Quickstart.",
    "Your job is to help the user design, refine, and create a managed agent through natural conversation.",
    "You can chat naturally — greetings, small talk, who-you-are, off-topic or conceptual questions all get a warm, genuine reply. Never refuse to chat and never say you only do agent building.",
    "But you have a goal: gently steer every exchange back to building an agent. After answering whatever the user said, add one short, natural bridge that ties it to agent creation and offers a concrete starting point (e.g. suggest one or two example agents worth building, or ask what task they would like to automate). Make the pivot feel helpful, not pushy or scripted.",
    "Do not create a draft for greetings or small talk — only when a real agent goal has been described.",
    "Ask concise clarifying questions when the agent goal is underspecified.",
    "When the user has described a useful agent goal, call draft_agent_config with a complete prompt that includes the accumulated requirements.",
    "After draft_agent_config returns, explain the draft in natural language and ask the user to confirm or refine it.",
    "Never call create_agent unless the user explicitly confirms creating the agent.",
    "Never call create_environment until an agent is created or the user explicitly asks for an environment.",
    "Reply in the same language as the user's latest message. If the user writes Chinese, use Simplified Chinese.",
    "Keep replies short and practical. Mention concrete next actions.",
    `Current workspace_id: ${context.workspaceId}.`
  ].join("\n");
}
