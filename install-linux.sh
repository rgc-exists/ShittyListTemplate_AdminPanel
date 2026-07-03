#!/usr/bin/env bash
set -euo pipefail

has_cmd() {
    command -v "$1" >/dev/null 2>&1
}

need_sudo() {
    if [[ "${EUID}" -eq 0 ]]; then
        "$@"
    else
        sudo "$@"
    fi
}

install_apt() {
    need_sudo apt-get update
    need_sudo apt-get install -y ca-certificates curl gnupg git nodejs npm

    if ! has_cmd gh; then
        need_sudo mkdir -p -m 755 /etc/apt/keyrings
        curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg |
            need_sudo tee /etc/apt/keyrings/githubcli-archive-keyring.gpg >/dev/null
        need_sudo chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg
        echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" |
            need_sudo tee /etc/apt/sources.list.d/github-cli.list >/dev/null
        need_sudo apt-get update
        need_sudo apt-get install -y gh
    fi
}

install_dnf() {
    need_sudo dnf install -y git nodejs npm

    if ! has_cmd gh; then
        need_sudo dnf install -y 'dnf-command(config-manager)' || true
        if has_cmd dnf5; then
            need_sudo dnf5 config-manager addrepo --from-repofile=https://cli.github.com/packages/rpm/gh-cli.repo
        else
            need_sudo dnf config-manager --add-repo https://cli.github.com/packages/rpm/gh-cli.repo
        fi
        need_sudo dnf install -y gh
    fi
}

install_yum() {
    need_sudo yum install -y git nodejs npm yum-utils
    if ! has_cmd gh; then
        need_sudo yum-config-manager --add-repo https://cli.github.com/packages/rpm/gh-cli.repo
        need_sudo yum install -y gh
    fi
}

install_pacman() {
    need_sudo pacman -Sy --needed git nodejs npm github-cli
}

install_zypper() {
    need_sudo zypper install -y git nodejs npm gh
}

echo "Checking Shitty List Template Admin Panel dependencies..."

if has_cmd node && has_cmd git && has_cmd gh; then
    echo "node, git, and gh are already installed."
else
    if has_cmd apt-get; then
        install_apt
    elif has_cmd dnf; then
        install_dnf
    elif has_cmd yum; then
        install_yum
    elif has_cmd pacman; then
        install_pacman
    elif has_cmd zypper; then
        install_zypper
    else
        echo "Unsupported package manager."
        echo "Install Node.js, Git, and GitHub CLI manually, then rerun this script."
        exit 1
    fi
fi

echo ""
echo "Installed versions:"
node --version || true
git --version || true
gh --version | head -n 1 || true

echo ""
echo "If a newly installed command is still not found, close and reopen your terminal."
