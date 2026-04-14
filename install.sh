#!/usr/bin/env bash
set -euo pipefail

PACKAGE_NAME="multi-agent-pipeline"
DEFAULT_REPO_URL="https://github.com/berlinguyinca/multi-agent-pipeline.git"
DEFAULT_BRANCH="main"
DEFAULT_OLLAMA_HOST="http://localhost:11434"
DEFAULT_OLLAMA_MODEL="gemma4:26b"
SOFTWARE_AGENTS=(
  researcher
  software-delivery
  spec-writer
  spec-qa-reviewer
  tdd-engineer
  implementation-coder
  code-qa-analyst
  bug-debugger
  build-fixer
  test-stabilizer
  refactor-cleaner
  docs-maintainer
  release-readiness-reviewer
)

log() {
  printf '[map install] %s\n' "$*"
}

die() {
  printf '[map install] ERROR: %s\n' "$*" >&2
  exit 1
}

have() {
  command -v "$1" >/dev/null 2>&1
}

is_interactive() {
  [[ -r /dev/tty && -w /dev/tty && "${MAP_ASSUME_DEFAULTS:-0}" != "1" ]]
}

is_map_checkout() {
  [[ -f package.json && -f src/cli.ts ]] &&
    grep -q '"name"[[:space:]]*:[[:space:]]*"multi-agent-pipeline"' package.json
}

require_command() {
  local cmd="$1"
  local hint="$2"
  have "$cmd" || die "Missing required command '$cmd'. $hint"
}

require_node_20() {
  node -e 'const major = Number(process.versions.node.split(".")[0]); process.exit(major >= 20 ? 0 : 1)' ||
    die "Node.js 20 or newer is required. Current version: $(node --version)"
}

git_dirty() {
  local repo_dir="$1"
  [[ -n "$(git -C "$repo_dir" status --porcelain)" ]]
}

update_git_checkout() {
  local repo_dir="$1"
  local branch="${MAP_BRANCH:-$DEFAULT_BRANCH}"

  require_command git "Install Git, then rerun this installer."

  if [[ "${MAP_NO_UPDATE:-0}" == "1" ]]; then
    log "Skipping self-update because MAP_NO_UPDATE=1"
    return
  fi

  if git_dirty "$repo_dir" && [[ "${MAP_FORCE_UPDATE:-0}" != "1" ]]; then
    log "Skipping self-update for $repo_dir because it has local changes."
    log "Commit/stash them, or rerun with MAP_FORCE_UPDATE=1 if you intentionally want git to try anyway."
    return
  fi

  log "Updating checkout at $repo_dir from origin/$branch"
  git -C "$repo_dir" fetch origin "$branch"
  git -C "$repo_dir" checkout "$branch"
  git -C "$repo_dir" pull --ff-only origin "$branch"
}

prompt_value() {
  local label="$1"
  local default_value="$2"
  local value

  if ! is_interactive; then
    printf '%s\n' "$default_value"
    return
  fi

  read -r -p "$label [$default_value]: " value </dev/tty
  printf '%s\n' "${value:-$default_value}"
}

prompt_yes_no() {
  local label="$1"
  local default_value="$2"
  local value
  local suffix

  if [[ "$default_value" == "yes" ]]; then
    suffix="Y/n"
  else
    suffix="y/N"
  fi

  if ! is_interactive; then
    [[ "$default_value" == "yes" ]]
    return
  fi

  read -r -p "$label [$suffix]: " value </dev/tty
  value="${value:-$default_value}"

  case "$value" in
    y|Y|yes|YES|Yes) return 0 ;;
    *) return 1 ;;
  esac
}

adapter_available() {
  local adapter="$1"
  case "$adapter" in
    claude) have claude ;;
    codex) have codex ;;
    ollama) have ollama ;;
    hermes) have hermes ;;
    *) return 1 ;;
  esac
}

first_available_adapter() {
  local fallback="$1"
  shift

  local adapter
  for adapter in "$@"; do
    if adapter_available "$adapter"; then
      printf '%s\n' "$adapter"
      return
    fi
  done

  printf '%s\n' "$fallback"
}

print_backend_summary() {
  log "Backend detection:"
  local adapter
  for adapter in claude codex ollama hermes; do
    if adapter_available "$adapter"; then
      log "  $adapter: installed"
    else
      log "  $adapter: not found"
    fi
  done

  if ! adapter_available claude &&
    ! adapter_available codex &&
    ! adapter_available ollama &&
    ! adapter_available hermes; then
    log "No AI backend was detected. The generated config will default to Ollama."
    log "Install Ollama, Claude CLI, Codex CLI, or Hermes before running MAP examples."
  fi

  log ""
  log "GitHub integration:"
  if have gh; then
    log "  gh CLI: installed"
    if gh auth status >/dev/null 2>&1; then
      log "  gh auth: authenticated"
    else
      log "  gh auth: not logged in (run 'gh auth login' for GitHub features)"
    fi
  else
    log "  gh CLI: not found (install from https://cli.github.com for GitHub features)"
  fi
}

prompt_adapter() {
  local label="$1"
  local default_value="$2"
  local value

  if ! is_interactive; then
    printf '%s\n' "$default_value"
    return
  fi

  while true; do
    read -r -p "$label [claude/codex/ollama/hermes, default: $default_value]: " value </dev/tty
    value="${value:-$default_value}"
    case "$value" in
      claude|codex|ollama|hermes)
        printf '%s\n' "$value"
        return
        ;;
      *)
        log "Please choose one of: claude, codex, ollama, hermes"
        ;;
    esac
  done
}

prompt_model_for_adapter() {
  local label="$1"
  local adapter="$2"
  local default_model="$3"
  local value

  if [[ "$adapter" == "ollama" ]]; then
    prompt_value "$label model" "$default_model"
    return
  fi

  if ! is_interactive; then
    printf '%s\n' "${MAP_DEFAULT_MODEL:-}"
    return
  fi

  read -r -p "$label model (optional, empty is fine): " value </dev/tty
  printf '%s\n' "$value"
}

resolve_install_dir() {
  if is_map_checkout; then
    pwd
    return
  fi

  printf '%s\n' "${MAP_INSTALL_DIR:-$HOME/.local/share/multi-agent-pipeline}"
}

clone_or_update_repo() {
  local install_dir="$1"
  local repo_url="${MAP_REPO_URL:-$DEFAULT_REPO_URL}"
  local branch="${MAP_BRANCH:-$DEFAULT_BRANCH}"

  require_command git "Install Git, then rerun this installer."

  if [[ -d "$install_dir/.git" ]]; then
    update_git_checkout "$install_dir"
    return
  fi

  if [[ -e "$install_dir" ]]; then
    if [[ -n "$(find "$install_dir" -mindepth 1 -maxdepth 1 2>/dev/null)" ]]; then
      die "$install_dir exists and is not an empty git checkout. Set MAP_INSTALL_DIR to another path."
    fi
  fi

  log "Cloning $repo_url#$branch into $install_dir"
  mkdir -p "$(dirname "$install_dir")"
  git clone --branch "$branch" "$repo_url" "$install_dir"
}

build_cli() {
  local install_dir="$1"

  require_command node "Install Node.js 20 or newer."
  require_node_20
  require_command npm "Install npm with Node.js."

  cd "$install_dir"

  log "Installing npm dependencies"
  npm install

  log "Building MAP CLI"
  npm run build
  chmod +x dist/cli.js
}

link_cli() {
  local install_dir="$1"

  if [[ "${MAP_NO_LINK:-0}" == "1" ]]; then
    log "Skipping npm link because MAP_NO_LINK=1"
    log "Run directly: $install_dir/dist/cli.js --help"
    return
  fi

  cd "$install_dir"

  log "Linking global map command"
  if ! npm link; then
    die "npm link failed. You can still run directly with: $install_dir/dist/cli.js --help"
  fi

  log "Installed global command:"
  map --version
}

write_agent_assignment() {
  local file="$1"
  local name="$2"
  local adapter="$3"
  local model="$4"

  {
    printf '  %s:\n' "$name"
    printf '    adapter: %s\n' "$adapter"
    if [[ -n "$model" ]]; then
      printf '    model: %s\n' "$model"
    fi
  } >>"$file"
}

write_adapter_config() {
  local file="$1"
  local indent="$2"
  local adapter="$3"
  local model="$4"

  {
    printf '%sadapter: %s\n' "$indent" "$adapter"
    if [[ -n "$model" ]]; then
      printf '%smodel: %s\n' "$indent" "$model"
    fi
  } >>"$file"
}

write_agent_override() {
  local file="$1"
  local agent="$2"
  local adapter="$3"
  local model="$4"
  local enabled="$5"

  {
    printf '  %s:\n' "$agent"
    printf '    adapter: %s\n' "$adapter"
    if [[ -n "$model" ]]; then
      printf '    model: %s\n' "$model"
    fi
    printf '    enabled: %s\n' "$enabled"
  } >>"$file"
}

configure_pipeline() {
  local install_dir="$1"
  local config_path="${MAP_CONFIG_PATH:-$HOME/.map/pipeline.yaml}"

  if [[ "${MAP_SKIP_ONBOARDING:-0}" == "1" ]]; then
    log "Skipping onboarding because MAP_SKIP_ONBOARDING=1"
    return
  fi

  if [[ -f "$config_path" && "${MAP_FORCE_CONFIG:-0}" != "1" ]]; then
    log "Keeping existing config at $config_path"
    return
  fi

  if [[ ! -f "$config_path" ]]; then
    log "No MAP config found at $config_path. Onboarding can create one now."
  elif [[ "${MAP_FORCE_CONFIG:-0}" == "1" ]]; then
    log "MAP_FORCE_CONFIG=1 set; onboarding will replace $config_path."
  fi

  if ! prompt_yes_no "Generate MAP configuration at $config_path" "yes"; then
    log "Skipping config generation"
    return
  fi

  local ollama_model
  local ollama_host
  local spec_adapter
  local review_adapter
  local qa_adapter
  local execute_adapter
  local docs_adapter
  local router_adapter
  local agent_creation_adapter
  local v2_agent_adapter
  local spec_model
  local review_model
  local qa_model
  local execute_model
  local docs_model
  local router_model
  local agent_creation_model
  local v2_agent_model
  local output_dir

  print_backend_summary

  ollama_model="$(prompt_value "Ollama model for local agents" "${MAP_OLLAMA_MODEL:-$DEFAULT_OLLAMA_MODEL}")"
  ollama_host="$(prompt_value "Ollama host" "${MAP_OLLAMA_HOST:-$DEFAULT_OLLAMA_HOST}")"
  output_dir="$(prompt_value "Default output directory" "${MAP_OUTPUT_DIR:-./output}")"

  spec_adapter="$(prompt_adapter "Spec generation adapter" "$(first_available_adapter ollama claude ollama codex hermes)")"
  spec_model="$(prompt_model_for_adapter "Spec generation" "$spec_adapter" "$ollama_model")"
  review_adapter="$(prompt_adapter "Spec review adapter" "$(first_available_adapter ollama codex ollama claude hermes)")"
  review_model="$(prompt_model_for_adapter "Spec review" "$review_adapter" "$ollama_model")"
  qa_adapter="$(prompt_adapter "QA adapter" "$(first_available_adapter ollama codex ollama claude hermes)")"
  qa_model="$(prompt_model_for_adapter "QA" "$qa_adapter" "$ollama_model")"
  execute_adapter="$(prompt_adapter "Execution adapter" "$(first_available_adapter ollama claude ollama codex hermes)")"
  execute_model="$(prompt_model_for_adapter "Execution" "$execute_adapter" "$ollama_model")"
  docs_adapter="$(prompt_adapter "Docs adapter" "$(first_available_adapter ollama claude ollama codex hermes)")"
  docs_model="$(prompt_model_for_adapter "Docs" "$docs_adapter" "$ollama_model")"
  router_adapter="$(prompt_adapter "Smart-routing router adapter" "$(first_available_adapter ollama ollama codex claude hermes)")"
  router_model="$(prompt_model_for_adapter "Smart-routing router" "$router_adapter" "$ollama_model")"
  agent_creation_adapter="$(prompt_adapter "Agent creation adapter" "$(first_available_adapter ollama ollama claude codex hermes)")"
  agent_creation_model="$(prompt_model_for_adapter "Agent creation" "$agent_creation_adapter" "$ollama_model")"
  v2_agent_adapter="$(prompt_adapter "Default software-delivery agent adapter" "${MAP_DEFAULT_AGENT_ADAPTER:-$(first_available_adapter ollama ollama claude codex hermes)}")"
  v2_agent_model="$(prompt_model_for_adapter "Default software-delivery agent" "$v2_agent_adapter" "$ollama_model")"

  mkdir -p "$(dirname "$config_path")"

  {
    printf '# MAP Pipeline Configuration\n'
    printf '# Generated by install.sh. Edit this file any time.\n\n'
    printf 'agents:\n'
  } >"$config_path"

  write_agent_assignment "$config_path" spec "$spec_adapter" "$spec_model"
  write_agent_assignment "$config_path" review "$review_adapter" "$review_model"
  write_agent_assignment "$config_path" qa "$qa_adapter" "$qa_model"
  write_agent_assignment "$config_path" execute "$execute_adapter" "$execute_model"
  write_agent_assignment "$config_path" docs "$docs_adapter" "$docs_model"

  {
    printf '\nrouter:\n'
  } >>"$config_path"
  write_adapter_config "$config_path" "  " "$router_adapter" "$router_model"
  {
    printf '  maxSteps: 10\n'
    printf '  timeoutMs: 30s\n\n'
    printf 'agentCreation:\n'
  } >>"$config_path"
  write_adapter_config "$config_path" "  " "$agent_creation_adapter" "$agent_creation_model"

  {
    printf '\nagentOverrides:\n'
  } >>"$config_path"

  local customize_agents="no"
  if prompt_yes_no "Customize each software-delivery agent individually" "no"; then
    customize_agents="yes"
  fi

  local agent
  local agent_enabled
  local agent_adapter
  local agent_model
  for agent in "${SOFTWARE_AGENTS[@]}"; do
    if [[ "$customize_agents" == "yes" ]]; then
      if prompt_yes_no "Enable agent '$agent'" "yes"; then
        agent_enabled="true"
        agent_adapter="$(prompt_adapter "Adapter for agent '$agent'" "$v2_agent_adapter")"
        agent_model="$(prompt_model_for_adapter "Agent '$agent'" "$agent_adapter" "${v2_agent_model:-$ollama_model}")"
      else
        agent_enabled="false"
        agent_adapter="$v2_agent_adapter"
        agent_model="$v2_agent_model"
      fi
    else
      agent_enabled="true"
      agent_adapter="$v2_agent_adapter"
      agent_model="$v2_agent_model"
    fi

    write_agent_override "$config_path" "$agent" "$agent_adapter" "$agent_model" "$agent_enabled"
  done

  {
    printf '\nollama:\n'
    printf '  host: %s\n\n' "$ollama_host"
    printf 'quality:\n'
    printf '  maxSpecQaIterations: 3\n'
    printf '  maxCodeQaIterations: 3\n\n'
    printf 'headless:\n'
    printf '  totalTimeoutMs: 60m\n'
    printf '  inactivityTimeoutMs: 10m\n'
    printf '  pollIntervalMs: 10s\n\n'
    printf 'outputDir: %s\n' "$output_dir"
    printf 'gitCheckpoints: true\n'
  } >>"$config_path"

  # Capture GitHub token from gh CLI if available
  if have gh && gh auth status >/dev/null 2>&1; then
    local gh_token
    gh_token="$(gh auth token 2>/dev/null)" || true
    if [[ -n "$gh_token" ]]; then
      {
        printf '\ngithub:\n'
        printf '  token: %s\n' "$gh_token"
      } >>"$config_path"
      log "GitHub token captured from gh CLI"
    fi
  fi

  log "Wrote config: $config_path"

  if [[ ! -x "$install_dir/dist/cli.js" ]]; then
    log "Built CLI not found at $install_dir/dist/cli.js; skipping agent list/custom generation"
    return
  fi

  if prompt_yes_no "List available agents now" "yes"; then
    "$install_dir/dist/cli.js" agent list || true
  fi

  if prompt_yes_no "Generate a custom agent now" "no"; then
    "$install_dir/dist/cli.js" agent create \
      --adapter "$agent_creation_adapter" \
      --model "$ollama_model"
  fi
}

print_next_steps() {
  local install_dir="$1"
  local config_path="${MAP_CONFIG_PATH:-$HOME/.map/pipeline.yaml}"

  cat <<EOF

MAP is ready.

Run:
  map --help
  map --config "$config_path"
  map
  map --headless "Build a tested Node.js CLI"
  map --headless --personality "Be concise and strict about test evidence." "Build a tested Node.js CLI"
  map --headless --v2 "Build the feature with TDD and QA review"
  map agent create --adapter ollama --model ${MAP_OLLAMA_MODEL:-$DEFAULT_OLLAMA_MODEL}

Local checkout:
  $install_dir

Config:
  $config_path

Rebuild after source changes:
  cd "$install_dir" && scripts/build-map.sh

Rerun onboarding:
  cd "$install_dir" && scripts/configure-map.sh

GitHub integration:
  gh auth login                              # Authenticate with GitHub
  map --review-pr https://github.com/owner/repo/pull/123
  map --github-issue https://github.com/owner/repo/issues/1

Uninstall global link:
  cd "$install_dir" && scripts/unlink-map.sh

EOF
}

main() {
  local install_dir
  install_dir="$(resolve_install_dir)"

  if [[ "${1:-}" == "--configure-only" ]]; then
    configure_pipeline "$install_dir"
    return
  fi

  if is_map_checkout; then
    log "Using current checkout at $install_dir"
    update_git_checkout "$install_dir"
  else
    clone_or_update_repo "$install_dir"
  fi

  build_cli "$install_dir"
  link_cli "$install_dir"
  configure_pipeline "$install_dir"
  print_next_steps "$install_dir"
}

main "$@"
