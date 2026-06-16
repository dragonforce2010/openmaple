# Maple Tool Gateway

Service boundary for the Maple MCP/tool gateway. P0 keeps the service as a
placeholder while the existing control-plane tool path remains active. P1 will
lift the `mira_mcp_proxy` service into this directory and replace its config
source with Maple control-plane MCP/vault records.
