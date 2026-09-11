# Saved output and argument handling

Human output is useful for orientation; JSON is useful when preserving structure or inspecting data locally. `call-tool` does not shorten a large result merely because human output was selected.

## Save schemas without loading every schema into context

The relative scratch paths below are rooted at the project directory. When starting in a subdirectory, use the project's scratch path or change to the project root first. Use a fresh destination for each task so another task's saved results remain intact. The following POSIX-shell example creates its output directory and leaves stderr visible:

```sh
mkdir -p .tmp/mcp-discovery
mcp-z inspect --servers sheets --tools --json > .tmp/mcp-discovery/sheets-tools.json
```

Check the command's exit status before parsing, and check the inspected server's status even when the command succeeded. With `jq` installed, select the tool you need and fail if it is missing:

```sh
jq -e 'if .servers.sheets.status != "ready" then error("sheets inspection failed") else .servers.sheets.tools[] | select(.name == "rows-get") end' .tmp/mcp-discovery/sheets-tools.json
```

The CLI currently inspects schemas at server granularity. Local selection limits what enters model context; it does not reduce what the server returned. Use an available local JSON reader if jq is not installed. Full saved output remains available when another tool becomes relevant.

The same redirection works for a large tool result:

```sh
mcp-z call-tool SERVER TOOL '{"argument":"value"}' --json > .tmp/mcp-discovery/result.json
```

Use actual discovered arguments, including bounds or requested fields where supported. After checking command success, inspect the response shape and any application errors before extracting rows. Preserve pagination tokens and retrieve remaining pages when completeness matters. A tool's result fields depend on that tool; there is no universal `.rows` field. Store sensitive output only in a suitable private local location and follow the project's retention policy.

Failure output may contain more than one JSON object. Keep failure diagnostics rather than assuming every stdout file is a single success document. Redirection saves output as it is written; it does not make the CLI or server a streaming data API.

## Pass JSON as one argument

The CLI accepts positional JSON, not an `@file` argument or stdin-input mode. POSIX shells preserve JSON inside single quotes:

```sh
mcp-z call-tool SERVER TOOL '{"argument":"value"}' --json
```

For complex text, use a local JSON file and your shell's argument-passing rules. In a POSIX shell:

```sh
mcp-z call-tool SERVER TOOL "$(< arguments.json)" --json
```

That substitution form is supported by bash and zsh. On Windows with PowerShell 7.3 or newer using `Windows` or `Standard` native argument passing, read the entire file as one string and use npm's PowerShell launcher:

```powershell
$toolArguments = Get-Content -Raw -LiteralPath .\arguments.json
mcp-z.ps1 call-tool SERVER TOOL $toolArguments --json
```

This requires the npm-installed `.ps1` launcher and an execution policy that permits it. A `.cmd` launcher adds another shell and can revert to legacy quoting. Windows PowerShell 5.1 and legacy native argument passing handle embedded quotes differently; do not treat POSIX single-quote examples as portable to those modes. See [PowerShell native argument handling](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_parsing#passing-arguments-that-contain-quote-characters) when diagnosing that branch. File substitution still passes an argument and remains subject to OS command-line length limits. Avoid interpolating untrusted values into shell source; compose JSON with a serializer when values are dynamic.
