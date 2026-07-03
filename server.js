const http = require("http");
const fs = require("fs/promises");
const fsSync = require("fs");
const path = require("path");
const { execFile, spawn } = require("child_process");

const args = process.argv.slice(2);
const argValue = (name) => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
};

const adminRoot = __dirname;
const defaultRepoRoot = path.resolve(adminRoot, "VopracioDemonList");
let repoRoot = path.resolve(
    process.env.LIST_REPO_DIR || argValue("--repo") || defaultRepoRoot,
);
let dataDir = path.join(repoRoot, "data");
const publicDir = path.join(adminRoot, "public");
const port = Number(process.env.PORT || argValue("--port") || 4173);
const host = "127.0.0.1";
const cloneRoot = path.resolve(
    process.env.LIST_CLONE_ROOT ||
        argValue("--clone-root") ||
        adminRoot,
);
const loginJobs = new Map();

const levelKeyOrder = [
    "id",
    "name",
    "author",
    "creators",
    "verifier",
    "verification",
    "showcase",
    "percentToQualify",
    "password",
    "records",
];

const mimeTypes = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
};

function sendJson(res, status, value) {
    res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
    });
    res.end(JSON.stringify(value, null, 2));
}

function sendError(res, status, message, details) {
    sendJson(res, status, { error: message, details });
}

function isPlainObject(value) {
    return value && typeof value === "object" && !Array.isArray(value);
}

function validateSlug(slug, label = "Level file name") {
    if (typeof slug !== "string") {
        throw new Error(`${label} must be text.`);
    }

    const clean = slug.trim();
    if (!clean) {
        throw new Error(`${label} is required.`);
    }

    if (clean.length > 120) {
        throw new Error(`${label} is too long.`);
    }

    if (!/^[A-Za-z0-9][A-Za-z0-9 _-]*$/.test(clean)) {
        throw new Error(
            `${label} can use letters, numbers, spaces, underscores, and hyphens only.`,
        );
    }

    if (["_list", "_editors"].includes(clean.toLowerCase())) {
        throw new Error(`${label} cannot be ${clean}.`);
    }

    return clean;
}

function safeDataPath(fileName) {
    const resolved = path.resolve(dataDir, fileName);
    const prefix = path.resolve(dataDir) + path.sep;
    if (!resolved.startsWith(prefix)) {
        throw new Error("Refusing to access a file outside the data folder.");
    }

    return resolved;
}

async function readJson(filePath) {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
}

async function writeJson(filePath, value) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, `${JSON.stringify(value, null, 4)}\n`, "utf8");
}


function existingDataFileNames(fileNames, fallbackFileName) {
    const existing = fileNames.filter((fileName) =>
        fsSync.existsSync(safeDataPath(fileName)),
    );

    return existing.length > 0 ? existing : [fallbackFileName];
}
async function readFirstJson(fileNames) {
    const errors = [];

    for (const fileName of fileNames) {
        try {
            return {
                fileName,
                value: await readJson(safeDataPath(fileName)),
            };
        } catch (error) {
            errors.push(`${fileName}: ${error.message}`);
        }
    }

    throw new Error(errors.join("; "));
}
function defaultLevel(slug) {
    return {
        id: "",
        name: slug.replace(/[_-]+/g, " "),
        author: "",
        creators: [],
        verifier: "",
        verification: "",
        percentToQualify: 100,
        password: "",
        records: [],
    };
}

function orderLevelData(data) {
    const ordered = {};
    for (const key of levelKeyOrder) {
        if (Object.prototype.hasOwnProperty.call(data, key)) {
            ordered[key] = data[key];
        }
    }

    for (const [key, value] of Object.entries(data)) {
        if (!levelKeyOrder.includes(key)) {
            ordered[key] = value;
        }
    }

    return ordered;
}

function normalizeLevelData(data) {
    if (!isPlainObject(data)) {
        throw new Error("Each level must be a JSON object.");
    }

    const normalized = { ...data };
    normalized.creators = Array.isArray(normalized.creators)
        ? normalized.creators
              .map((creator) => String(creator).trim())
              .filter(Boolean)
        : [];
    normalized.records = Array.isArray(normalized.records)
        ? normalized.records.map((record) =>
              isPlainObject(record) ? { ...record } : {},
          )
        : [];

    return orderLevelData(normalized);
}

function normalizeEditors(editors) {
    if (!Array.isArray(editors)) {
        throw new Error("Editors must be an array.");
    }

    return editors
        .map((editor) => ({
            role: String(editor.role || "").trim(),
            name: String(editor.name || "").trim(),
            link: String(editor.link || "").trim(),
        }))
        .filter((editor) => editor.name);
}

function setRepoRoot(nextRepoRoot) {
    repoRoot = path.resolve(nextRepoRoot);
    dataDir = path.join(repoRoot, "data");
}

function runCommand(command, commandArgs, options = {}) {
    const cwd = options.cwd || repoRoot;
    const timeout = options.timeout || 20000;

    return new Promise((resolve, reject) => {
        execFile(
            command,
            commandArgs,
            {
                cwd,
                timeout,
                windowsHide: true,
                maxBuffer: 1024 * 1024 * 4,
            },
            (error, stdout, stderr) => {
                const result = {
                    args: [command, ...commandArgs],
                    stdout: stdout.trim(),
                    stderr: stderr.trim(),
                    code:
                        error && typeof error.code === "number"
                            ? error.code
                            : 0,
                };

                if (error) {
                    if (error.code === "ENOENT") {
                        result.code = "ENOENT";
                    }
                    const wrapped = new Error(
                        result.stderr ||
                            result.stdout ||
                            (error.code === "ENOENT"
                                ? `${command} was not found on PATH.`
                                : error.message),
                    );
                    wrapped.result = result;
                    reject(wrapped);
                    return;
                }

                resolve(result);
            },
        );
    });
}

function git(argsForGit, timeout = 20000) {
    return runCommand("git", argsForGit, { cwd: repoRoot, timeout });
}

function gh(argsForGh, timeout = 30000) {
    return runCommand("gh", argsForGh, { cwd: adminRoot, timeout });
}

function normalizeGitHubRepo(input) {
    const raw = String(input || "").trim();
    if (!raw) {
        throw new Error("GitHub repo is required.");
    }

    const sshMatch = raw.match(/^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/i);
    if (sshMatch) {
        return {
            ref: `${sshMatch[1]}/${sshMatch[2]}`,
            cloneUrl: `https://github.com/${sshMatch[1]}/${sshMatch[2]}.git`,
            name: sshMatch[2],
        };
    }

    let pathname = raw;
    try {
        const parsed = new URL(raw);
        if (!/github\.com$/i.test(parsed.hostname)) {
            throw new Error("Only github.com repositories are supported.");
        }
        pathname = parsed.pathname.replace(/^\/+/, "");
    } catch (error) {
        if (/^https?:\/\//i.test(raw)) {
            throw error;
        }
    }

    const clean = pathname.replace(/\.git$/i, "").replace(/\/+$/g, "");
    const parts = clean.split("/").filter(Boolean);
    if (parts.length < 2) {
        throw new Error(
            "Use a GitHub repo like owner/name or https://github.com/owner/name.",
        );
    }

    const [owner, repo] = parts;
    if (!/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repo)) {
        throw new Error(
            "GitHub repo owner/name contains unsupported characters.",
        );
    }

    return {
        ref: `${owner}/${repo}`,
        cloneUrl: `https://github.com/${owner}/${repo}.git`,
        name: repo,
    };
}

function resolveCloneTarget(repoInfo, localPath) {
    const target = String(localPath || "").trim()
        ? path.resolve(localPath)
        : path.join(cloneRoot, repoInfo.name);

    const parent = path.dirname(target);
    return { target, parent };
}

async function getGithubInfo() {
    const info = {
        available: false,
        authenticated: false,
        user: "",
        status: "",
        error: "",
    };

    try {
        const version = await gh(["--version"], 10000);
        info.available = true;
        info.status = version.stdout.split(/\r?\n/)[0] || "GitHub CLI found.";
    } catch (error) {
        info.error = error.message;
        return info;
    }

    try {
        const status = await gh(
            ["auth", "status", "--hostname", "github.com"],
            15000,
        );
        info.authenticated = true;
        info.status = [status.stdout, status.stderr].filter(Boolean).join("\n");
        try {
            info.user = (
                await gh(["api", "user", "--jq", ".login"], 15000)
            ).stdout;
        } catch (error) {
            info.user = "";
        }
    } catch (error) {
        info.authenticated = false;
        info.error = error.message;
        info.status = error.result
            ? [error.result.stdout, error.result.stderr]
                  .filter(Boolean)
                  .join("\n")
            : error.message;
    }

    return info;
}

async function getGitConfigValue(key) {
    try {
        return (await git(["config", "--get", key], 10000)).stdout.trim();
    } catch (error) {
        return "";
    }
}

function missingGitIdentityMessage() {
    return [
        "Git author identity is missing.",
        "Log in with GitHub in the admin panel, then try again so the panel can set user.name and user.email for this repo only.",
        "If you want to set it manually instead, run git config user.name \"Your Name\" and git config user.email \"you@example.com\" inside the cloned repo.",
    ].join(" ");
}

function isMissingGitIdentityError(error) {
    const result = error && error.result ? error.result : {};
    const message = [
        error && error.message ? error.message : "",
        result.stdout || "",
        result.stderr || "",
    ].join("\n");

    return /Author identity unknown|unable to auto-detect email address/i.test(message);
}

async function getGithubUserId() {
    try {
        return (await gh(["api", "user", "--jq", ".id"], 15000)).stdout.trim();
    } catch (error) {
        return "";
    }
}

async function ensureGitIdentity() {
    const configuredName = await getGitConfigValue("user.name");
    const configuredEmail = await getGitConfigValue("user.email");

    if (configuredName && configuredEmail) {
        return {
            configured: false,
            name: configuredName,
            email: configuredEmail,
        };
    }

    const github = await getGithubInfo();
    if (!github.available || !github.authenticated || !github.user) {
        throw new Error(missingGitIdentityMessage());
    }

    const githubId = await getGithubUserId();
    const fallbackName = github.user;
    const fallbackEmail = githubId
        ? `${githubId}+${github.user}@users.noreply.github.com`
        : `${github.user}@users.noreply.github.com`;
    const name = configuredName || fallbackName;
    const email = configuredEmail || fallbackEmail;

    if (!configuredName) {
        await git(["config", "user.name", name]);
    }
    if (!configuredEmail) {
        await git(["config", "user.email", email]);
    }

    return {
        configured: true,
        name,
        email,
    };
}
async function getGitInfo() {
    const info = {
        available: false,
        branch: "",
        head: "",
        remote: "",
        upstream: "",
        branchStatus: "",
        status: [],
        error: "",
    };

    try {
        await git(["rev-parse", "--is-inside-work-tree"]);
        info.available = true;
        info.branch =
            (await git(["branch", "--show-current"])).stdout || "(detached)";
        info.head = (await git(["log", "-1", "--pretty=%h %s"])).stdout;
        try {
            info.remote = (await git(["remote", "get-url", "origin"])).stdout;
        } catch (error) {
            info.remote = "";
        }
        try {
            info.upstream = (
                await git([
                    "rev-parse",
                    "--abbrev-ref",
                    "--symbolic-full-name",
                    "@{u}",
                ])
            ).stdout;
        } catch (error) {
            info.upstream = "";
        }
        try {
            info.branchStatus = (
                await git(["status", "--short", "--branch"])
            ).stdout;
        } catch (error) {
            info.branchStatus = "";
        }
        const status = await git(["status", "--short", "--", "data"]);
        info.status = status.stdout ? status.stdout.split(/\r?\n/) : [];
    } catch (error) {
        info.error = error.message;
    }

    return info;
}

async function readState() {
    const baseState = {
        repoRoot,
        dataDir,
        cloneRoot,
        levels: [],
        editors: [],
        git: await getGitInfo(),
        github: await getGithubInfo(),
        repoError: "",
    };

    let list;
    let listFileName = "_list.json";

    try {
        const result = await readFirstJson(["_list.json", "list.json"]);
        list = result.value;
        listFileName = result.fileName;
    } catch (error) {
        return {
            ...baseState,
            repoError: `Failed to read data/_list.json or data/list.json: ${error.message}`,
        };
    }

    if (!Array.isArray(list)) {
        return {
            ...baseState,
            repoError: `data/${listFileName} must contain an array of level file names.`,
        };
    }

    const levels = [];
    for (const item of list) {
        const slug = validateSlug(String(item), "Existing level file name");
        const filePath = safeDataPath(`${slug}.json`);
        try {
            const data = await readJson(filePath);
            levels.push({ slug, data: normalizeLevelData(data), error: "" });
        } catch (error) {
            levels.push({
                slug,
                data: defaultLevel(slug),
                error: `Failed to read ${slug}.json: ${error.message}`,
            });
        }
    }

    let editors = [];
    try {
        const result = await readFirstJson(["_editors.json", "editors.json"]);
        editors = normalizeEditors(result.value);
    } catch (error) {
        editors = [];
    }

    return {
        ...baseState,
        levels,
        editors,
    };
}

async function saveState(body) {
    if (!isPlainObject(body) || !Array.isArray(body.levels)) {
        throw new Error("Save payload must include a levels array.");
    }

    const cleanLevels = body.levels.map((level, index) => {
        if (!isPlainObject(level)) {
            throw new Error(`Level ${index + 1} is not valid.`);
        }

        const slug = validateSlug(level.slug, `Level ${index + 1} file name`);
        const previousSlug = level.previousSlug
            ? validateSlug(
                  level.previousSlug,
                  `Level ${index + 1} previous file name`,
              )
            : slug;

        return {
            slug,
            previousSlug,
            data: normalizeLevelData(level.data),
        };
    });

    const seen = new Set();
    for (const level of cleanLevels) {
        const key = level.slug.toLowerCase();
        if (seen.has(key)) {
            throw new Error(`Duplicate level file name: ${level.slug}`);
        }
        seen.add(key);
    }

    const list = cleanLevels.map((level) => level.slug);
    const editors = normalizeEditors(body.editors || []);
    const deletedSlugs = Array.isArray(body.deletedSlugs)
        ? body.deletedSlugs.map((slug) =>
              validateSlug(slug, "Deleted level file name"),
          )
        : [];

    const staleSlugs = new Set(deletedSlugs);
    for (const level of cleanLevels) {
        if (
            level.previousSlug &&
            level.previousSlug.toLowerCase() !== level.slug.toLowerCase() &&
            !list.some(
                (slug) =>
                    slug.toLowerCase() === level.previousSlug.toLowerCase(),
            )
        ) {
            staleSlugs.add(level.previousSlug);
        }
    }

    for (const fileName of existingDataFileNames(["_list.json", "list.json"], "_list.json")) {
        await writeJson(safeDataPath(fileName), list);
    }
    for (const fileName of existingDataFileNames(["_editors.json", "editors.json"], "_editors.json")) {
        await writeJson(safeDataPath(fileName), editors);
    }
    for (const level of cleanLevels) {
        await writeJson(safeDataPath(`${level.slug}.json`), level.data);
    }

    if (body.deleteRemovedFiles !== false) {
        for (const slug of staleSlugs) {
            if (
                list.some(
                    (liveSlug) => liveSlug.toLowerCase() === slug.toLowerCase(),
                )
            ) {
                continue;
            }

            const filePath = safeDataPath(`${slug}.json`);
            if (fsSync.existsSync(filePath)) {
                await fs.unlink(filePath);
            }
        }
    }

    return readState();
}

async function commitData(body) {
    const message = String(body && body.message ? body.message : "").trim();
    if (!message) {
        throw new Error("Commit message is required.");
    }

    await git(["add", "--", "data"]);
    const status = await git(["status", "--short", "--", "data"]);
    if (!status.stdout) {
        return {
            committed: false,
            output: "No data changes to commit.",
            git: await getGitInfo(),
            github: await getGithubInfo(),
        };
    }

    const identity = await ensureGitIdentity();

    let commit;
    try {
        commit = await git(["commit", "-m", message], 60000);
    } catch (error) {
        if (isMissingGitIdentityError(error)) {
            throw new Error(missingGitIdentityMessage());
        }
        throw error;
    }

    const identityOutput = identity.configured
        ? `Configured Git author as ${identity.name} <${identity.email}> for this repo.`
        : "";

    return {
        committed: true,
        output: [identityOutput, commit.stdout, commit.stderr]
            .filter(Boolean)
            .join("\n"),
        git: await getGitInfo(),
        github: await getGithubInfo(),
    };
}

async function selectRepo(body) {
    const nextRepoRoot = String(
        body && body.repoRoot ? body.repoRoot : "",
    ).trim();
    if (!nextRepoRoot) {
        throw new Error("Local repo path is required.");
    }

    setRepoRoot(nextRepoRoot);
    return readState();
}

function serializeLoginJob(job) {
    if (!job) {
        return null;
    }

    return {
        id: job.id,
        pid: job.pid,
        running: job.running,
        done: job.done,
        success: job.success,
        output: job.output,
        error: job.error,
        startedAt: job.startedAt,
        finishedAt: job.finishedAt,
    };
}

async function loginGithub() {
    const before = await getGithubInfo();
    if (!before.available) {
        throw new Error(
            "GitHub CLI is not installed or is not on PATH. Install gh, then restart this admin server.",
        );
    }

    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const job = {
        id,
        pid: 0,
        running: true,
        done: false,
        success: false,
        output: "",
        error: "",
        startedAt: new Date().toISOString(),
        finishedAt: "",
    };
    loginJobs.set(id, job);

    const child = spawn(
        "gh",
        [
            "auth",
            "login",
            "--hostname",
            "github.com",
            "--git-protocol",
            "https",
            "--web",
            "--scopes",
            "repo",
        ],
        {
            cwd: adminRoot,
            windowsHide: true,
            stdio: ["pipe", "pipe", "pipe"],
        },
    );

    job.pid = child.pid || 0;

    const append = (chunk) => {
        job.output += chunk.toString();
        if (job.output.length > 20000) {
            job.output = job.output.slice(-20000);
        }
    };

    child.stdout.on("data", append);
    child.stderr.on("data", append);

    child.on("error", (error) => {
        job.running = false;
        job.done = true;
        job.success = false;
        job.error = error.message;
        job.finishedAt = new Date().toISOString();
        append(`${error.message}\n`);
    });

    child.on("close", async (code) => {
        job.running = false;
        job.done = true;
        job.finishedAt = new Date().toISOString();

        if (code === 0) {
            try {
                const setup = await gh(["auth", "setup-git", "--hostname", "github.com"], 60000);
                append(`\n${[setup.stdout, setup.stderr].filter(Boolean).join("\n")}\n`);
                job.success = true;
            } catch (error) {
                job.success = false;
                job.error = error.message;
                append(`\n${error.message}\n`);
            }
        } else {
            job.success = false;
            job.error = `GitHub login exited with code ${code}.`;
            append(`\n${job.error}\n`);
        }

        const cleanup = setTimeout(() => loginJobs.delete(id), 10 * 60 * 1000);
        if (cleanup.unref) {
            cleanup.unref();
        }
    });

    try {
        child.stdin.write("\n");
        child.stdin.end();
    } catch (error) {
        // The GitHub CLI may not need stdin for this auth flow.
    }

    return {
        job: serializeLoginJob(job),
        github: before,
    };
}

async function getGithubLoginStatus(id) {
    const job = loginJobs.get(String(id || ""));
    if (!job) {
        throw new Error("GitHub login job was not found. Start login again if needed.");
    }

    return {
        job: serializeLoginJob(job),
        github: await getGithubInfo(),
    };
}
async function cloneRepo(body) {
    const repo = normalizeGitHubRepo(body && body.repo);
    const { target, parent } = resolveCloneTarget(repo, body && body.localPath);

    if (fsSync.existsSync(target)) {
        const entries = await fs.readdir(target).catch(() => []);
        if (entries.length > 0) {
            setRepoRoot(target);
            return {
                ...(await readState()),
                output: `Local folder already exists, so the panel selected it instead of cloning: ${target}`,
            };
        }
    }

    await fs.mkdir(parent, { recursive: true });

    const github = await getGithubInfo();
    let result;
    if (github.available && github.authenticated) {
        result = await gh(["repo", "clone", repo.ref, target], 300000);
    } else {
        result = await runCommand("git", ["clone", repo.cloneUrl, target], {
            cwd: parent,
            timeout: 300000,
        });
    }

    setRepoRoot(target);
    return {
        ...(await readState()),
        output: [result.stdout, result.stderr].filter(Boolean).join("\n"),
    };
}

async function pushRepo() {
    const gitInfo = await getGitInfo();
    if (!gitInfo.available) {
        throw new Error(
            gitInfo.error || "Selected folder is not a Git repository.",
        );
    }

    if (!gitInfo.remote) {
        throw new Error("No origin remote is configured for this repo.");
    }

    if (!gitInfo.branch || gitInfo.branch === "(detached)") {
        throw new Error(
            "Cannot push while HEAD is detached. Check out a branch first.",
        );
    }

    let result;
    try {
        result = await git(["push"], 300000);
    } catch (error) {
        const text = [error.result?.stdout, error.result?.stderr, error.message]
            .filter(Boolean)
            .join("\n");
        if (
            /no upstream branch|set the remote as upstream|has no upstream/i.test(
                text,
            )
        ) {
            result = await git(
                ["push", "--set-upstream", "origin", gitInfo.branch],
                300000,
            );
        } else {
            throw error;
        }
    }

    return {
        pushed: true,
        output: [result.stdout, result.stderr].filter(Boolean).join("\n"),
        git: await getGitInfo(),
        github: await getGithubInfo(),
    };
}

async function pullRepo() {
    const gitInfo = await getGitInfo();
    if (!gitInfo.available) {
        throw new Error(
            gitInfo.error || "Selected folder is not a Git repository.",
        );
    }

    if (!gitInfo.remote) {
        throw new Error("No origin remote is configured for this repo.");
    }

    if (!gitInfo.branch || gitInfo.branch === "(detached)") {
        throw new Error(
            "Cannot pull while HEAD is detached. Check out a branch first.",
        );
    }

    const pull = await git(["pull", "--ff-only"], 300000);
    return {
        ...(await readState()),
        pulled: true,
        output:
            [pull.stdout, pull.stderr].filter(Boolean).join("\n") ||
            "Already up to date.",
    };
}

function parseBody(req) {
    return new Promise((resolve, reject) => {
        let body = "";
        req.on("data", (chunk) => {
            body += chunk;
            if (body.length > 10 * 1024 * 1024) {
                reject(new Error("Request body is too large."));
                req.destroy();
            }
        });
        req.on("end", () => {
            if (!body) {
                resolve({});
                return;
            }

            try {
                resolve(JSON.parse(body));
            } catch (error) {
                reject(new Error("Request body must be valid JSON."));
            }
        });
        req.on("error", reject);
    });
}

async function handleApi(req, res, url) {
    try {
        if (req.method === "GET" && url.pathname === "/api/state") {
            sendJson(res, 200, await readState());
            return true;
        }

        if (req.method === "GET" && url.pathname === "/api/status") {
            sendJson(res, 200, {
                git: await getGitInfo(),
                github: await getGithubInfo(),
            });
            return true;
        }

        if (req.method === "POST" && url.pathname === "/api/repo/select") {
            sendJson(res, 200, await selectRepo(await parseBody(req)));
            return true;
        }

        if (req.method === "POST" && url.pathname === "/api/repo/clone") {
            sendJson(res, 200, await cloneRepo(await parseBody(req)));
            return true;
        }

        if (req.method === "POST" && url.pathname === "/api/github/login") {
            sendJson(res, 200, await loginGithub());
            return true;
        }

                if (req.method === "GET" && url.pathname === "/api/github/login/status") {
            sendJson(res, 200, await getGithubLoginStatus(url.searchParams.get("id")));
            return true;
        }

        if (req.method === "GET" && url.pathname === "/api/github/status") {
            sendJson(res, 200, { github: await getGithubInfo() });
            return true;
        }

        if (req.method === "POST" && url.pathname === "/api/save") {
            sendJson(res, 200, await saveState(await parseBody(req)));
            return true;
        }

        if (req.method === "POST" && url.pathname === "/api/commit") {
            sendJson(res, 200, await commitData(await parseBody(req)));
            return true;
        }

        if (req.method === "POST" && url.pathname === "/api/push") {
            sendJson(res, 200, await pushRepo());
            return true;
        }

        if (req.method === "POST" && url.pathname === "/api/pull") {
            sendJson(res, 200, await pullRepo());
            return true;
        }
    } catch (error) {
        sendError(
            res,
            400,
            error.message,
            error.result
                ? [error.result.stdout, error.result.stderr]
                      .filter(Boolean)
                      .join("\n")
                : undefined,
        );
        return true;
    }

    return false;
}

async function serveStatic(req, res, url) {
    const pathname = decodeURIComponent(url.pathname);
    const relativePath = pathname === "/" ? "index.html" : pathname.slice(1);
    const filePath = path.resolve(publicDir, relativePath);
    const publicPrefix = path.resolve(publicDir) + path.sep;

    if (!filePath.startsWith(publicPrefix)) {
        res.writeHead(403);
        res.end("Forbidden");
        return;
    }

    try {
        const stat = await fs.stat(filePath);
        const target = stat.isDirectory()
            ? path.join(filePath, "index.html")
            : filePath;
        const ext = path.extname(target).toLowerCase();
        res.writeHead(200, {
            "Content-Type": mimeTypes[ext] || "application/octet-stream",
            "Cache-Control": "no-store",
        });
        fsSync.createReadStream(target).pipe(res);
    } catch (error) {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Not found");
    }
}

const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

    if (url.pathname.startsWith("/api/")) {
        const handled = await handleApi(req, res, url);
        if (!handled) {
            sendError(res, 404, "API route not found.");
        }
        return;
    }

    await serveStatic(req, res, url);
});

server.on("error", (error) => {
    if (error.code === "EADDRINUSE") {
        console.error(
            `Port ${port} is already in use. The admin panel may already be running at http://${host}:${port}`,
        );
        console.error(
            `Try another port with: node server.js --port ${port + 1}`,
        );
        process.exit(1);
    }

    console.error(error);
    process.exit(1);
});

server.listen(port, host, () => {
    console.log(`Shitty List Template Admin Panel`);
    console.log(`Admin: http://${host}:${port}`);
    console.log(`Repo:  ${repoRoot}`);
});
