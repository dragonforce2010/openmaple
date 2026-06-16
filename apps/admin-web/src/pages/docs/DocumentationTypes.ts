import type { ReactElement, ReactNode } from "react";

export type DocId =
  | "overview"
  | "quickstart"
  | "authentication"
  | "workspaces-api"
  | "agents-api"
  | "sessions-api"
  | "environments-api"
  | "vaults-api"
  | "mcp-api"
  | "errors"
  | "sdks"
  | "cli"
  | "skills";

export type DocSection = { id: string; h2: string; body: ReactNode };
export type DocPage = { title: string; lead: string; sections: DocSection[] };
export type FieldRow = { field: string; type: string; required: string; description: ReactNode };

export type DocContentHelpers = {
  L: (zh: string, en: string) => string;
  Code: (props: { children: string }) => ReactElement;
  DocCard: (props: { id: DocId; icon: string; title: string; desc: string }) => ReactElement;
  FieldTable: (props: { rows: FieldRow[] }) => ReactElement;
  EndpointList: (props: { rows: Array<[string, string]> }) => ReactElement;
};
