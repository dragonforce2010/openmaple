# Credential vault UX implementation

## Video Findings

- Empty Credential vaults page has search by name/id, Status filter, table columns ID/Name/Status/Created, centered empty lock state, and top-right Create vault.
- Create vault modal: compact modal, warning banner, Name field, character hint, Continue.
- After vault creation, list row appears and Add credential modal opens for that vault.
- Add credential modal: name optional, auth type select, MCP server combobox, inline MCP registry dropdown, optional Access token, optional OAuth client credentials, warning banner, acknowledgement checkbox, Skip for now and Connect.
- Connect flow shows Checking auth method, then Credential created interstitial, then returns to vault detail/list.
- Final vault row shows name, credential identity, MCP server, status active, created/last used/updated, Add credential button, row menu with Archive/Delete.

## Tasks

- [ ] Add vault search/status filter/empty state parity.
- [ ] Add vault row/detail expansion with credential list data.
- [ ] Align create vault modal copy/layout.
- [ ] Improve Add credential modal combobox/provider/auth flow and loading state.
- [ ] Add credential created interstitial and return to vault detail.
- [ ] Add credential row actions UI and API archive/delete support if missing.
- [ ] Verify typecheck/build/browser flow.
