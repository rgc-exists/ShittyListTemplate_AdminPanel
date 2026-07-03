#!/usr/bin/env bash
set -euo pipefail

admin_root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$admin_root"

if ! command -v node >/dev/null 2>&1; then
    echo "Node.js is required. Run ./install-linux.sh first."
    exit 1
fi

port="${PORT:-4173}"
repo=""
clone_root=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --port)
            port="${2:?Missing value for --port}"
            shift 2
            ;;
        --repo)
            repo="${2:?Missing value for --repo}"
            shift 2
            ;;
        --clone-root)
            clone_root="${2:?Missing value for --clone-root}"
            shift 2
            ;;
        *)
            echo "Unknown argument: $1"
            echo "Usage: ./run-linux.sh [--port 4173] [--repo /path/to/repo] [--clone-root /path/to/folder]"
            exit 1
            ;;
    esac
done

args=(server.js --port "$port")

if [[ -n "$repo" ]]; then
    args+=(--repo "$repo")
fi

if [[ -n "$clone_root" ]]; then
    args+=(--clone-root "$clone_root")
fi

exec node "${args[@]}"
