# notrack

Check local telemetry settings for developer tools and print opt-out snippets you can review before running. The bundled catalog covers 40 tools across AI coding agents, framework CLIs, cloud CLIs, package managers, editors, and other developer tools.

Scanning is read-only. notrack checks declared PATH commands, environment variables, and user configuration paths without running the detected developer tools. On Windows it also reads optional diagnostic data settings. It does not change files, environment variables, or the registry; `--fix` only prints suggestions.

## Installation

Requires Node.js 20+ and npm. Clone this repository using the clone URL on its repository page, then enter the checkout's root directory. Run the following commands from that root:

```sh
npm ci
npm run build
```

Installing dependencies may access the npm registry. Once installed and built, scanning and snippet generation work offline using the bundled rules. No account, credentials, or environment file is required. notrack has no telemetry, background service, or online rule updates.

## Usage

Run these commands from the checkout root after building.

Show detected tools, installation evidence, telemetry status, and the reason for each result:

```sh
node dist/cli.js
```

Print a machine-readable report with `schemaVersion: 1`:

```sh
node dist/cli.js --json
```

Print opt-out suggestions for detected tools that are not confirmed disabled:

```sh
node dist/cli.js --fix --shell bash
```

Review the output and its official documentation links before applying any suggestions yourself. Some suggestions are environment assignments, some are configuration commands, and others are comments describing manual steps. Environment assignments affect only the shell where you execute them and subsequent child processes. Configuration commands may persist changes when you choose to run them.

Supported shells are `bash`, `zsh`, `fish`, and `powershell`. With `--fix`, the default is PowerShell on Windows and bash elsewhere. `--shell` requires `--fix`; `--fix` and `--json` cannot be combined.

Show all CLI options:

```sh
node dist/cli.js --help
```

Use `--color` or `--no-color` to control table colors, and `--version` to print the package version. By default, colors require a terminal and an unset `NO_COLOR` variable. Exit codes are 0 for a successful scan or snippet, 1 for a global failure such as unreadable rules, and 2 for invalid arguments. Enabled or unknown results still exit 0; diagnostics go to stderr.

## Interpreting results

Results are inferences from visible settings, within each rule's documented version and platform scope.

| Status | Meaning |
| --- | --- |
| `enabled` | A recognized setting explicitly enables telemetry. |
| `default_on` | No visible override was found and the documented default is on. |
| `disabled` | Recognized settings or a documented default indicate telemetry is off within the rule's scope. |
| `unknown` | Settings, permissions, version, channel, or precedence cannot establish a reliable result. |

`DO_NOT_TRACK=1` affects only tools whose rules explicitly support it. The value must be exactly `1`; it is not a universal opt-out. JSON includes `doNotTrack` for the current environment and `supportsDoNotTrack` for each detected tool. Tool-specific settings and documented precedence still apply.

Detection covers declared PATH candidates and user configuration paths. A leftover configuration file can count as detection evidence after a tool is uninstalled. Project dependencies, project configuration, containers, remote hosts, and other users' accounts are outside the scan. JSON/JSONC settings are parsed where declared; other configuration formats may provide existence evidence only.

notrack does not inspect, capture, or block network traffic, and cannot verify actual reporting behavior or undisclosed telemetry. A disabled result applies only to the telemetry covered by that rule. Review [the bundled rules](data/tools.json) for version limits, evidence, and official opt-out documentation.

On Windows, optional diagnostic data is reported separately from developer tools. Access failures or unrecognized settings produce `unknown`. On other platforms, JSON reports `windowsDiagnostics: null`.

## Environment

[`.env.example`](.env.example) documents optional scan controls and the tool-specific environment opt-outs recognized by the bundled rules. No credentials are required. notrack reads the inherited process environment and does not automatically load `.env` files; export the settings you choose in your shell before running the CLI.

## Testing

From the checkout root, run the automated suite, package installation check, and dependency audit:

```sh
npm test
npm run test:package
npm run test:audit
```

The automated suite uses synthetic tool fixtures and simulated Windows registry reads. The package check builds a local tarball, installs it into a temporary directory inside the checkout, and verifies the installed help, version, and JSON commands with `npx --offline`. Installing its runtime dependencies may access the npm registry; execution checks run offline. The temporary installation is removed afterward.

The dependency audit queries the npm registry for known vulnerabilities, including development dependencies, and fails if any are reported. It requires network access.

Built with Claude Code & Codex
