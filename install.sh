#!/usr/bin/env bash
set -euo pipefail

PACKAGE_NAME="multi-agent-pipeline"
DEFAULT_REPO_URL="https://github.com/berlinguyinca/multi-agent-pipeline.git"
DEFAULT_BRANCH="main"

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
    log "Updating existing checkout at $install_dir"
    git -C "$install_dir" fetch origin "$branch"
    git -C "$install_dir" checkout "$branch"
    git -C "$install_dir" pull --ff-only origin "$branch"
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

print_next_steps() {
  local install_dir="$1"

  cat <<EOF

MAP is ready.

Run:
  map --help
  map
  map --headless "Build a tested Node.js CLI"
  map --headless --v2 "Build the feature with TDD and QA review"

Local checkout:
  $install_dir

Rebuild after source changes:
  cd "$install_dir" && scripts/build-map.sh

Uninstall global link:
  cd "$install_dir" && scripts/unlink-map.sh

EOF
}

main() {
  local install_dir
  install_dir="$(resolve_install_dir)"

  if is_map_checkout; then
    log "Using current checkout at $install_dir"
  else
    clone_or_update_repo "$install_dir"
  fi

  build_cli "$install_dir"
  link_cli "$install_dir"
  print_next_steps "$install_dir"
}

main "$@"
