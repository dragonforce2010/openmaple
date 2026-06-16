# Maple Agent SDK

Node/TypeScript SDK for Maple Managed Agent Platform integrations.

```bash
npm install maple-agent-sdk
```

```ts
import { MapleClient } from "maple-agent-sdk";

const client = new MapleClient({
  baseURL: "https://sd8ihq8v316pc5mf9c1j0.apigateway-cn-beijing.volceapi.com",
  apiKey: process.env.MAPLE_API_KEY || "maple_ws_xxx",
  workspaceId: "ws_xxx"
});

const run = await client.createSessionAndStream({
  agent: "agent_xxx",
  environment_id: "env_xxx",
  title: "Integration smoke",
  metadata: { integration_model_id: "model_xxx" },
  message: "Summarize the uploaded files."
}, {
  onEvent(event) {
    if (event.type === "agent.message_delta") process.stdout.write(String(event.text ?? ""));
    if (event.type === "session.status_failed") console.error(event.error ?? event.payload);
  }
});

console.error(`session ${run.session.id}`);
await run.done;
```

`MAPLE_API_KEY` should be the full workspace API key with the `maple_ws_` prefix, not the shortened `key_prefix` shown in lists. The console integration panel fills in `baseURL`, `workspaceId`, `agent`, `environment_id`, and the agent model id.
