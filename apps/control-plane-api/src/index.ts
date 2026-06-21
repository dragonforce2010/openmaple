import cors from "cors";
import express,{ type NextFunction,type Request,type Response } from "express";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { authCookieName, requireAuth } from "./auth";
import { startDeploymentScheduler } from "./deployments/scheduler";
import "./env";
import { ensureGlobalModelConfigs } from "./modelGateway";
import { registerAgentEnvironmentRoutes } from "./routes/agentEnvironmentRoutes";
import { registerArtifactFileRoutes } from "./routes/artifactFileRoutes";
import { registerBootstrapRoutes } from "./routes/bootstrapRoutes";
import { registerDeploymentRoutes } from "./routes/deploymentRoutes";
import { registerMcpRoutes } from "./routes/mcpRoutes";
import { registerMemorySkillTemplateRoutes } from "./routes/memorySkillTemplateRoutes";
import { registerModelConfigRoutes } from "./routes/modelConfigRoutes";
import { registerPublicRoutes } from "./routes/publicRoutes";
import { registerQuickstartRoutes } from "./routes/quickstartRoutes";
import { registerSessionRoutes } from "./routes/sessionRoutes";
import { registerTenantRoutes } from "./routes/tenantRoutes";
import { registerVaultRoutes } from "./routes/vaultRoutes";
import { registerWorkspaceRoutes } from "./routes/workspaceRoutes";
import { initDatabase } from "./store";

const packageInfo = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as { version?: string; name?: string };

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "2mb" }));
app.use((request, _response, next) => {
  const override = String(request.header("x-http-method-override") || "").toUpperCase();
  if (request.method === "POST" && (override === "PATCH" || override === "DELETE")) {
    request.method = override;
  }
  next();
});

let databaseInitialized = false;

function ensureDatabaseInitialized() {
  if (databaseInitialized) return;
  initDatabase();
  try {
    ensureGlobalModelConfigs();
  } catch (error) {
    console.error("[startup] seed defaults failed:", error);
  }
  databaseInitialized = true;
}

function anonymousAuthBootstrap(response: Response) {
  response.clearCookie(authCookieName, { path: "/" });
  response.json({ user: null, tenants: [], created_count: 0, owned_count: 0, member_only_count: 0, recommended_view: "login" });
}

function isAuthBootstrapRequest(request: Request) {
  return request.path === "/v1/auth/bootstrap" || request.path.startsWith("/v1/auth/bootstrap/");
}

function ensureDatabaseReady(request: Request, response: Response, next: NextFunction) {
  if (isAuthBootstrapRequest(request) && !databaseInitialized) {
    anonymousAuthBootstrap(response);
    return;
  }
  try {
    ensureDatabaseInitialized();
    next();
  } catch (error) {
    if (isAuthBootstrapRequest(request)) {
      anonymousAuthBootstrap(response);
      return;
    }
    response.status(503).json({
      error: "database_unavailable",
      message: error instanceof Error ? error.message : String(error)
    });
  }
}

registerPublicRoutes(app, packageInfo, ensureDatabaseReady);
app.use("/v1", requireAuth);
registerBootstrapRoutes(app);
registerTenantRoutes(app);
registerWorkspaceRoutes(app);
registerModelConfigRoutes(app);
registerArtifactFileRoutes(app);
registerQuickstartRoutes(app);
registerAgentEnvironmentRoutes(app);
registerSessionRoutes(app);
registerDeploymentRoutes(app);
registerVaultRoutes(app);
registerMcpRoutes(app);
registerMemorySkillTemplateRoutes(app);

const distDir = join(process.cwd(), "dist");
const shouldServeStatic = process.env.SERVE_STATIC === "true" || (process.env.NODE_ENV === "production" && process.env.SERVE_STATIC !== "false");
if (shouldServeStatic && existsSync(join(distDir, "index.html"))) {
  app.use(express.static(distDir));
  app.get(/.*/, (_request, response) => {
    response.sendFile(join(distDir, "index.html"));
  });
}

const port = Number(process.env.PORT || 27951);
const host = process.env.HOST || "127.0.0.1";
app.listen(port, host, () => {
  console.log("Maple API listening on http://" + host + ":" + port);
  startDeploymentScheduler(ensureDatabaseInitialized);
});
