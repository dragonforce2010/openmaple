import type { DocContentHelpers, DocId, DocPage } from "./DocumentationTypes";
import { mcpDoc, vaultsDoc } from "./documentationIntegrationContent";
import { authenticationDoc, overviewDoc, quickstartDoc } from "./documentationIntroContent";
import { environmentsDoc, sessionsDoc } from "./documentationRuntimeContent";
import { cliDoc, errorsDoc, sdkDoc, skillsDoc } from "./documentationSdkContent";
import { agentsDoc, workspacesDoc } from "./documentationWorkspaceContent";

export function docPage(id: DocId, helpers: DocContentHelpers): DocPage {
  switch (id) {
    case "quickstart":
      return quickstartDoc(helpers);
    case "authentication":
      return authenticationDoc(helpers);
    case "workspaces-api":
      return workspacesDoc(helpers);
    case "agents-api":
      return agentsDoc(helpers);
    case "environments-api":
      return environmentsDoc(helpers);
    case "sessions-api":
      return sessionsDoc(helpers);
    case "vaults-api":
      return vaultsDoc(helpers);
    case "mcp-api":
      return mcpDoc(helpers);
    case "errors":
      return errorsDoc(helpers);
    case "sdks":
      return sdkDoc(helpers);
    case "cli":
      return cliDoc(helpers);
    case "skills":
      return skillsDoc(helpers);
    default:
      return overviewDoc(helpers);
  }
}
