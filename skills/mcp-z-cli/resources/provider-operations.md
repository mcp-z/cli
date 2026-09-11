# Read and update a spreadsheet

This example assumes a working `.mcp.json` entry named `sheets` for `@mcp-z/mcp-sheets`, with its required provider configuration. Replace the example keys if yours differ. Tool names and arguments below illustrate that server, not a universal MCP API. Inspect the installed server before composing an unfamiliar call.

## Resolve and read

```sh
mcp-z inspect --servers sheets --tools --json
mcp-z call-tool sheets spreadsheet-find '{"spreadsheetRef":"CONFIRMED_SPREADSHEET_URL"}' --json
```

Resolve ambiguous matches before proceeding. Use the returned workbook ID and the intended tab's ID; in these tools, `id` identifies the workbook and `gid` is the tab ID expressed as a string.

```sh
mcp-z call-tool sheets rows-get '{"id":"WORKBOOK_ID","gid":"TAB_GID","range":"A1:H50","render":"FORMULA"}' --json
mcp-z call-tool sheets rows-get '{"id":"WORKBOOK_ID","gid":"TAB_GID","range":"A1:H50","render":"UNFORMATTED_VALUE"}' --json
```

Choose the read needed for the task. Formula text explains computation; unformatted values give calculated results for comparison. `FORMATTED_VALUE` is useful for displayed dates, currencies, and labels. The range is an example bound, not proof that all rows fit within it. Expand or follow pagination when the task needs more.

For MCP-Z Google and Microsoft servers, perform the actual requested read-only operation to trigger OAuth when needed. Schema discovery alone does not prove provider access. `account-me` is not an authentication prerequisite: Gmail can authenticate ephemerally for a call without creating a persistent account entry. If consent or configuration is required, report that specific requirement and follow the server's supported flow. Keep tokens and authorization URLs out of saved reports.

## Make an authorized bounded update

Only run a write when the user has requested that change. Confirm the workbook, tab, range, and current values first. Preserve the before-state needed to verify or recover the change; broader or structural changes may need a verified backup under the project's policy.

For an approved literal label change in a confirmed cell:

```sh
mcp-z call-tool sheets values-batch-update '{"id":"WORKBOOK_ID","gid":"TAB_GID","requests":[{"range":"B2","values":[["Approved label"]],"majorDimension":"ROWS"}],"valueInputOption":"RAW","includeData":true}' --json
mcp-z call-tool sheets rows-get '{"id":"WORKBOOK_ID","gid":"TAB_GID","range":"B2","render":"UNFORMATTED_VALUE"}' --json
```

The coordinates and label are illustrative, not proposed edits. `RAW` preserves literal input. Use `USER_ENTERED` when the intended input needs formula or date parsing, accounting for the workbook's locale. Match data dimensions to the target range. Inspect returned errors and verify the actual value rather than treating process success as proof of the intended change.

A timeout does not prove a write failed. Read the destination before retrying, especially for appends or resource creation. Multiple CLI calls are not a transaction. Preserve any intervening user changes during recovery.
