# Model gateway agent model UX plan

## Scope
- Add a model gateway connectivity test so users can see whether a model config can complete a minimal chat request.
- Seed each user with a default VolcoEngine model config:
  - name: `VolcoEngine`
  - model: `glm-4-7-251222`
  - baseUrl: `https://ark.cn-beijing.volces.com/api/v3`
  - apiKey: stored through the existing secret store and never returned by list APIs.
- Let users select a model during agent creation, edit an existing agent's model, and let natural-language creation either use the default model or infer a suitable model from the prompt.
- Improve UI responsiveness with clearer loading, pressed, hover, selected, empty, and test-result states.

## Files
- `server/modelGateway.ts`: connectivity test helper and default VolcoEngine constants.
- `server/index.ts`: ensure defaults on login/listing, add model test routes, include model selection in agent draft request.
- `server/agentBuilder.ts`: support preferred model config and model inference hints.
- `src/types.ts`: test result type.
- `src/App.tsx`: model test UI, agent model selector, agent model update UI.
- `src/api.ts`: reuse existing helpers.
- `src/styles.css`: tactile states, status cards, responsive table polish.
- `scripts/e2e.mjs`: API/UI checks for default model, test endpoint, model selection/update.

## Verification
- `npm run typecheck`
- `npm run build`
- Targeted API smoke via local server for model defaults and test route when practical.
