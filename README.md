## FULL TRANSPARENCY: I enslaved a clanker to make this because I was lazy.

# Shitty List Template Admin Panel

Local admin UI for editing a Shitty List template repo's `data` JSON files and committing those changes with Git.
The original shitty list repo: https://github.com/TheShittyList/GDListTemplate

## Install

Windows:

```powershell
.\install-windows.ps1
```

Linux:

```bash
bash ./install-linux.sh
```

These scripts install or check for:

- Node.js
- Git
- GitHub CLI (`gh`)


## Run

From this folder:

Windows:

```powershell
.\run-windows.ps1
```

Linux:

```bash
bash ./run-linux.sh
```

Open `http://127.0.0.1:4173`.

You can also use npm helpers:

```powershell
npm start
```

By default the panel targets `./VopracioDemonList`, which is ignored by Git for local repo clones. To point it at another template repo:

```powershell
.\run-windows.ps1 -Repo "E:\path\to\template-repo"
```

```bash
bash ./run-linux.sh --repo /path/to/template-repo
```

You can also pass a port:

```powershell
.\run-windows.ps1 -Port 4180 -Repo "E:\path\to\template-repo"
```

```bash
bash ./run-linux.sh --port 4180 --repo /path/to/template-repo
```

## GitHub

GitHub login, private repo cloning, and authenticated pushes use the GitHub CLI (`gh`).

Install it from <https://cli.github.com/>, restart the admin server, then use the Repo & GitHub tab to:

- log in with GitHub without freezing the panel; the Git tab shows the CLI output/code
- select an existing local checkout
- clone `owner/repo` or a GitHub repo URL
- pull the latest commits from the current branch, including an automatic startup pull when GitHub is signed in and the data folder is clean
- commit and push data from the top bar, or push the current branch from the Git tab

## Scope

The Save JSON locally button writes changes to the selected repo on disk. The commit button runs:

- `git add -- data`
- `git commit -m "<message>"`

That keeps admin commits focused on `_list.json`, `_editors.json`, and level JSON files.

The push button runs `git push` from the selected repo. If the current branch has no upstream yet, it uses `git push --set-upstream origin <branch>`.

The pull button runs `git pull --ff-only`, so it receives other people's commits only when Git can fast-forward cleanly.
