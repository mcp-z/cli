# Connection options

Ordinary configured stdio calls manage startup and cleanup themselves; they do not need a preceding `up` command. HTTP endpoints must be reachable. Use `mcp-z up` when the task is to keep a configured cluster running, including HTTP servers with the CLI's `start` extension. Stop the foreground cluster when your work no longer needs it.

For a one-off call without a configuration file, the CLI accepts `--run` for a stdio command or `--url` for an HTTP endpoint:

```sh
mcp-z call-tool local TOOL '{}' --url http://localhost:3000/mcp --json
mcp-z call-tool local TOOL '{}' --run "node /absolute/path/server.js" --json
```

These are syntax examples requiring a real reachable server and its actual tool and arguments. Use trusted server commands: starting a configured or inline command executes local code. A configured project is usually simpler for repeated operations and avoids repeating credentials in command arguments.

`inspect` and `search` accept `--attach` to avoid launching configured processes when inspecting already-running HTTP servers. This is not a way to borrow another process's stdio connection; `call-tool` has no `--attach` option.

The default protocol mode is `legacy`. Use `--protocol auto` when negotiation across protocol eras is needed. It probes modern support and falls back, but a silent legacy stdio server may take the full request timeout before fallback. Pin a revision only when the task requires that revision. Consult the installed command's help for accepted values.
