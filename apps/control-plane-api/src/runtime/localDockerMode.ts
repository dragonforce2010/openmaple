function truthy(value: unknown) {
  return ["1", "true", "yes"].includes(String(value || "").toLowerCase());
}

function falsy(value: unknown) {
  return ["0", "false", "no"].includes(String(value || "").toLowerCase());
}

export function isLocalDockerMode() {
  if (falsy(process.env.MAPLE_LOCAL_DOCKER_MODE)) return false;
  const runtimeProvider = process.env.MAPLE_AGENT_RUNTIME_PROVIDER || "";
  const sandboxProvider = process.env.MAPLE_SANDBOX_PROVIDER || "";
  if (runtimeProvider && runtimeProvider !== "local_docker") return false;
  if (sandboxProvider && sandboxProvider !== "local_docker") return false;
  return truthy(process.env.MAPLE_LOCAL_DOCKER_MODE) || (runtimeProvider === "local_docker" && sandboxProvider === "local_docker");
}
