const LEVEL_KEYS = [
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

const RECORD_KEYS = ["user", "link", "percent", "hz", "mobile"];
const EDITOR_ROLES = ["owner", "admin", "helper", "trial", "dev"];

const state = {
    repoRoot: "",
    dataDir: "",
    cloneRoot: "",
    levels: [],
    editors: [],
    git: null,
    github: null,
    githubLoginJob: null,
    githubLoginTimer: null,
    repoError: "",
    repoInput: "",
    localRepoPath: "",
    cloneLocalPath: "",
    selectedIndex: 0,
    activeTab: "levels",
    dirty: false,
    didAutoPull: false,
    deletedSlugs: new Set(),
    deleteRemovedFiles: true,
    notice: "",
    noticeType: "info",
    commitMessage: "Update demon list data",
};

const app = document.querySelector("#app");

function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function api(path, options = {}) {
    const headers = options.body
        ? { "Content-Type": "application/json", ...(options.headers || {}) }
        : options.headers || {};

    return fetch(path, { ...options, headers }).then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
            const details = body.details ? `\n\n${body.details}` : "";
            throw new Error(`${body.error || response.statusText}${details}`);
        }

        return body;
    });
}

function defaultLevelData(name = "New Level") {
    return {
        id: "",
        name,
        author: "",
        creators: [],
        verifier: "",
        verification: "",
        percentToQualify: 100,
        password: "",
        records: [],
    };
}

function slugify(name) {
    const slug = String(name || "NewLevel")
        .trim()
        .replace(/[^A-Za-z0-9 _-]+/g, "")
        .replace(/\s+/g, "_")
        .replace(/_+/g, "_")
        .replace(/^[_-]+|[_-]+$/g, "");
    return slug || "NewLevel";
}

function uniqueSlug(baseSlug) {
    const existing = new Set(
        state.levels.map((level) => level.slug.toLowerCase()),
    );
    let slug = slugify(baseSlug);
    let count = 2;
    while (existing.has(slug.toLowerCase())) {
        slug = `${slugify(baseSlug)}_${count}`;
        count += 1;
    }
    return slug;
}

function getExtraFields(data) {
    const extras = {};
    for (const [key, value] of Object.entries(data || {})) {
        if (!LEVEL_KEYS.includes(key)) {
            extras[key] = value;
        }
    }
    return extras;
}

function normalizeLevel(item) {
    const data = {
        ...defaultLevelData(item.slug),
        ...(clone(item.data || {}) || {}),
    };
    data.creators = Array.isArray(data.creators) ? data.creators : [];
    data.records = Array.isArray(data.records) ? data.records : [];

    return {
        slug: item.slug,
        previousSlug: item.slug,
        error: item.error || "",
        data,
        extraText: JSON.stringify(getExtraFields(data), null, 2),
    };
}

function markDirty() {
    state.dirty = true;
    updateDirtyUi();
}

function setNotice(message, type = "info") {
    state.notice = message;
    state.noticeType = type;
    const notice = document.querySelector("[data-notice]");
    if (notice) {
        notice.textContent = message;
        notice.className = `notice ${type}`;
        notice.hidden = !message;
    }
}

function updateDirtyUi() {
    const chip = document.querySelector("[data-dirty-chip]");
    if (!chip) {
        return;
    }

    chip.textContent = state.dirty ? "Unsaved JSON changes" : "JSON saved";
    chip.className = `status-chip ${state.dirty ? "dirty" : "clean"}`;

    document.querySelectorAll("[data-action='save']").forEach((button) => {
        button.disabled = !state.dirty;
    });
}

function selectedLevel() {
    return state.levels[state.selectedIndex] || null;
}

function fieldValue(value) {
    return escapeHtml(value ?? "");
}

function numericValue(value) {
    if (value === "" || value === null || value === undefined) {
        return "";
    }

    return Number(value);
}

function parseMaybeNumber(value) {
    const clean = String(value ?? "").trim();
    if (clean === "") {
        return "";
    }

    const number = Number(clean);
    return Number.isFinite(number) && String(number) === clean ? number : clean;
}

function parseNumber(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function render() {
    app.innerHTML = `
        <div class="app-shell">
            ${renderTopbar()}
            ${renderTabs()}
            <div data-notice class="notice ${state.noticeType}" ${state.notice ? "" : "hidden"}>${escapeHtml(state.notice)}</div>
            ${state.activeTab === "levels" ? renderLevelsView() : ""}
            ${state.activeTab === "editors" ? renderEditorsView() : ""}
            ${state.activeTab === "git" ? renderGitView() : ""}
        </div>
    `;
    updateDirtyUi();
}

function renderTopbar() {
    const branch =
        state.git && state.git.branch
            ? `Branch ${state.git.branch}`
            : "Git pending";
    return `
        <header class="topbar">
            <div class="brand">
                <h1>Shitty List Template Admin Panel</h1>
                <p class="repo-path">${escapeHtml(state.repoRoot || "No repo loaded")}</p>
            </div>
            <div class="toolbar">
                <span class="status-chip clean" data-dirty-chip>JSON saved</span>
                <span class="status-chip">${escapeHtml(branch)}</span>
                <button class="button" type="button" data-action="pull">Pull latest</button>
                <button class="button" type="button" data-action="reload">Reload</button>
                <button class="button primary" type="button" data-action="save">Save JSON locally</button>
                <button class="button blue" type="button" data-action="commit-push">Commit and push data</button>
            </div>
        </header>
    `;
}

function renderTabs() {
    const tabs = [
        ["levels", "Levels"],
        ["editors", "Editors"],
        ["git", "Git"],
    ];

    return `
        <nav class="tabs" aria-label="Admin views">
            ${tabs
                .map(
                    ([id, label]) => `
                        <button class="tab ${state.activeTab === id ? "active" : ""}" type="button" data-action="tab" data-tab="${id}">
                            ${label}
                        </button>
                    `,
                )
                .join("")}
        </nav>
    `;
}

function renderLevelsView() {
    return `
        <main class="workspace">
            ${renderLevelSidebar()}
            ${selectedLevel() ? renderLevelEditor(selectedLevel()) : renderNoLevel()}
        </main>
    `;
}

function renderLevelSidebar() {
    return `
        <aside class="sidebar">
            <div class="sidebar-head">
                <h2>List Order</h2>
                <button class="button small primary" type="button" data-action="add-level">Add level</button>
            </div>
            <ol class="level-list">
                ${state.levels
                    .map(
                        (level, index) => `
                            <li class="level-item ${index === state.selectedIndex ? "active" : ""}">
                                <span class="rank">#${index + 1}</span>
                                <button class="level-select" type="button" data-action="select-level" data-index="${index}">
                                    <strong>${escapeHtml(level.data.name || "Untitled level")}</strong>
                                    <span>${escapeHtml(level.slug)}.json</span>
                                </button>
                                <span class="move-stack">
                                    <button class="button small" type="button" data-action="move-level" data-index="${index}" data-direction="-1" ${index === 0 ? "disabled" : ""}>Up</button>
                                    <button class="button small" type="button" data-action="move-level" data-index="${index}" data-direction="1" ${index === state.levels.length - 1 ? "disabled" : ""}>Down</button>
                                </span>
                            </li>
                        `,
                    )
                    .join("")}
            </ol>
        </aside>
    `;
}

function renderNoLevel() {
    return `
        <section class="editor empty-state">
            <h2>No levels yet</h2>
            <button class="button primary" type="button" data-action="add-level">Add level</button>
        </section>
    `;
}

function renderLevelEditor(level) {
    const data = level.data;
    const rank = state.selectedIndex + 1;
    const error = level.error
        ? `<p class="error-text">${escapeHtml(level.error)}</p>`
        : "";

    return `
        <section class="editor">
            <div class="panel-head">
                <div>
                    <h2>${escapeHtml(data.name || "Untitled level")}</h2>
                    <p class="hint">${escapeHtml(level.slug)}.json</p>
                </div>
                <div class="inline-actions">
                    <label class="field" style="width: 118px;">
                        <span>Rank</span>
                        <input class="input" type="number" min="1" max="${state.levels.length}" value="${rank}" data-rank-input>
                    </label>
                    <button class="button" type="button" data-action="move-to-rank">Move</button>
                    <button class="button danger" type="button" data-action="remove-level" data-index="${state.selectedIndex}">Remove</button>
                </div>
            </div>
            ${error}
            <div class="section">
                <h3>Level</h3>
                <div class="form-grid">
                    <label class="field">
                        <span>File name</span>
                        <input class="input" type="text" value="${fieldValue(level.slug)}" data-level-slug>
                    </label>
                    <label class="field">
                        <span>Level name</span>
                        <input class="input" type="text" value="${fieldValue(data.name)}" data-level-field="name">
                    </label>
                    <label class="field">
                        <span>Level ID</span>
                        <input class="input" type="text" value="${fieldValue(data.id)}" data-level-field="id">
                    </label>
                    <label class="field">
                        <span>Publisher</span>
                        <input class="input" type="text" value="${fieldValue(data.author)}" data-level-field="author">
                    </label>
                    <label class="field">
                        <span>Verifier</span>
                        <input class="input" type="text" value="${fieldValue(data.verifier)}" data-level-field="verifier">
                    </label>
                    <label class="field">
                        <span>Percent to qualify</span>
                        <input class="input" type="number" min="0" max="100" step="1" value="${fieldValue(data.percentToQualify)}" data-level-field="percentToQualify">
                    </label>
                    <label class="field">
                        <span>Password</span>
                        <input class="input" type="text" value="${fieldValue(data.password)}" data-level-field="password">
                    </label>
                    <label class="field">
                        <span>Verification video</span>
                        <input class="input" type="url" value="${fieldValue(data.verification)}" data-level-field="verification">
                    </label>
                    <label class="field">
                        <span>Showcase video</span>
                        <input class="input" type="url" value="${fieldValue(data.showcase)}" data-level-field="showcase">
                    </label>
                </div>
            </div>
            ${renderCreators(data.creators)}
            ${renderRecords(data.records)}
            ${renderExtraFields(level)}
        </section>
    `;
}

function renderCreators(creators) {
    return `
        <div class="section">
            <div class="panel-head" style="padding: 0 0 12px; border-bottom: 0;">
                <h3>Creators</h3>
                <button class="button small" type="button" data-action="add-creator">Add creator</button>
            </div>
            <div class="inline-list">
                ${
                    creators.length
                        ? creators
                              .map(
                                  (creator, index) => `
                                    <div class="inline-row">
                                        <input class="input" type="text" value="${fieldValue(creator)}" data-creator-index="${index}">
                                        <button class="button small danger" type="button" data-action="remove-creator" data-index="${index}">Remove</button>
                                    </div>
                                `,
                              )
                              .join("")
                        : `<p class="hint">No extra creators. The publisher will display as the creator when this stays empty.</p>`
                }
            </div>
        </div>
    `;
}

function renderRecords(records) {
    return `
        <div class="section">
            <div class="panel-head" style="padding: 0 0 12px; border-bottom: 0;">
                <h3>Records</h3>
                <button class="button small" type="button" data-action="add-record">Add record</button>
            </div>
            <div class="records">
                ${
                    records.length
                        ? records
                              .map(
                                  (record, index) => `
                                    <div class="record-row">
                                        <label class="field">
                                            <span>User</span>
                                            <input class="input" type="text" value="${fieldValue(record.user)}" data-record-field="user" data-index="${index}">
                                        </label>
                                        <label class="field">
                                            <span>Video link</span>
                                            <input class="input" type="url" value="${fieldValue(record.link)}" data-record-field="link" data-index="${index}">
                                        </label>
                                        <label class="field">
                                            <span>Percent</span>
                                            <input class="input" type="number" min="0" max="100" step="1" value="${fieldValue(record.percent)}" data-record-field="percent" data-index="${index}">
                                        </label>
                                        <label class="field">
                                            <span>Hz</span>
                                            <input class="input" type="number" min="0" step="1" value="${fieldValue(record.hz)}" data-record-field="hz" data-index="${index}">
                                        </label>
                                        <label class="check-row">
                                            <input type="checkbox" ${record.mobile ? "checked" : ""} data-record-field="mobile" data-index="${index}">
                                            <span>Mobile</span>
                                        </label>
                                        <div class="row-actions">
                                            <button class="button small" type="button" data-action="move-record" data-index="${index}" data-direction="-1" ${index === 0 ? "disabled" : ""}>Up</button>
                                            <button class="button small" type="button" data-action="move-record" data-index="${index}" data-direction="1" ${index === records.length - 1 ? "disabled" : ""}>Down</button>
                                            <button class="button small danger" type="button" data-action="remove-record" data-index="${index}">Remove</button>
                                        </div>
                                    </div>
                                `,
                              )
                              .join("")
                        : `<p class="hint">No records for this level.</p>`
                }
            </div>
        </div>
    `;
}

function renderExtraFields(level) {
    return `
        <div class="section">
            <h3>Extra JSON Fields</h3>
            <label class="field wide">
                <span>Additional fields object</span>
                <textarea class="textarea" data-extra-json>${escapeHtml(level.extraText || "{}")}</textarea>
            </label>
            <p class="hint">Fields here are merged into the level JSON after the standard template fields.</p>
        </div>
    `;
}

function renderEditorsView() {
    return `
        <main class="wide-wrap">
            <section class="wide-panel">
                <div class="panel-head">
                    <h2>List Editors</h2>
                    <div class="inline-actions">
                        <button class="button small" type="button" data-action="sort-editors">Sort by role</button>
                        <button class="button small primary" type="button" data-action="add-editor">Add editor</button>
                    </div>
                </div>
                <div class="editor-table">
                    ${
                        state.editors.length
                            ? state.editors
                                  .map(
                                      (editor, index) => `
                                        <div class="editor-row">
                                            <label class="field">
                                                <span>Role</span>
                                                <select class="select" data-editor-field="role" data-index="${index}">
                                                    ${EDITOR_ROLES.map(
                                                        (role) =>
                                                            `<option value="${role}" ${editor.role === role ? "selected" : ""}>${role}</option>`,
                                                    ).join("")}
                                                </select>
                                            </label>
                                            <label class="field">
                                                <span>Name</span>
                                                <input class="input" type="text" value="${fieldValue(editor.name)}" data-editor-field="name" data-index="${index}">
                                            </label>
                                            <label class="field">
                                                <span>Link</span>
                                                <input class="input" type="url" value="${fieldValue(editor.link)}" data-editor-field="link" data-index="${index}">
                                            </label>
                                            <div class="row-actions">
                                                <button class="button small" type="button" data-action="move-editor" data-index="${index}" data-direction="-1" ${index === 0 ? "disabled" : ""}>Up</button>
                                                <button class="button small" type="button" data-action="move-editor" data-index="${index}" data-direction="1" ${index === state.editors.length - 1 ? "disabled" : ""}>Down</button>
                                                <button class="button small danger" type="button" data-action="remove-editor" data-index="${index}">Remove</button>
                                            </div>
                                        </div>
                                    `,
                                  )
                                  .join("")
                            : `<p class="hint">No list editors are configured.</p>`
                    }
                </div>
            </section>
        </main>
    `;
}

function renderGitView() {
    const git = state.git || {};
    const github = state.github || {};
    const dataStatus = git.error
        ? git.error
        : git.status && git.status.length
          ? git.status.join("\n")
          : "No pending data changes.";
    const status = git.branchStatus
        ? `${git.branchStatus}\n\nData changes:\n${dataStatus}`
        : dataStatus;
    const githubLabel = !github.available
        ? "GitHub CLI not found"
        : github.authenticated
          ? `Signed in${github.user ? ` as ${github.user}` : ""}`
          : "Not signed in";
    const repoProblem = state.repoError
        ? `<p class="notice error" style="margin: 0;">${escapeHtml(state.repoError)}</p>`
        : "";
    const remote = git.remote || "No origin remote";
    const upstream = git.upstream || "No upstream";
    const loginJob = state.githubLoginJob;
    const loginRunning = loginJob && loginJob.running;
    const loginOutput = loginJob
        ? loginJob.output ||
          loginJob.error ||
          (loginRunning ? "Waiting for GitHub CLI output..." : "")
        : "";
    const loginButtonText = loginRunning
        ? "Login running..."
        : "Log in with GitHub";

    return `
        <main class="wide-wrap">
            <section class="wide-panel">
                <div class="panel-head">
                    <div>
                        <h2>Repo & GitHub</h2>
                        <p class="hint">${escapeHtml(git.head || "No commit loaded")}</p>
                    </div>
                    <div class="inline-actions">
                        <span class="status-chip ${github.authenticated ? "clean" : "dirty"}">${escapeHtml(githubLabel)}</span>
                        <button class="button" type="button" data-action="refresh-git">Refresh</button>
                    </div>
                </div>
                <div class="repo-tools">
                    <div class="repo-card">
                        <h3>Local Checkout</h3>
                        <label class="field">
                            <span>Local repo path</span>
                            <input class="input" type="text" value="${fieldValue(state.localRepoPath || state.repoRoot)}" data-local-repo-path>
                        </label>
                        <div class="inline-actions">
                            <button class="button primary" type="button" data-action="select-repo">Use this folder</button>
                        </div>
                        ${repoProblem}
                    </div>
                    <div class="repo-card">
                        <h3>GitHub Repo</h3>
                        <label class="field">
                            <span>Repo</span>
                            <input class="input" type="text" placeholder="owner/name or GitHub URL" value="${fieldValue(state.repoInput)}" data-repo-input>
                        </label>
                        <label class="field">
                            <span>Clone to</span>
                            <input class="input" type="text" placeholder="${fieldValue(state.cloneRoot)}" value="${fieldValue(state.cloneLocalPath)}" data-clone-local-path>
                        </label>
                        <div class="inline-actions">
                            <button class="button" type="button" data-action="github-login" ${github.available && !loginRunning ? "" : "disabled"}>${escapeHtml(loginButtonText)}</button>
                            <button class="button primary" type="button" data-action="clone-repo">Clone or select</button>
                        </div>
                        ${loginOutput ? `<pre class="status-output login-output">${escapeHtml(loginOutput)}</pre>` : ""}
                    </div>
                </div>
                <div class="git-grid">
                    <div class="status-box">
                        <p class="status-line"><strong>Branch:</strong> ${escapeHtml(git.branch || "unknown")}</p>
                        <p class="status-line"><strong>Origin:</strong> ${escapeHtml(remote)}</p>
                        <p class="status-line"><strong>Upstream:</strong> ${escapeHtml(upstream)}</p>
                        <p class="status-line"><strong>Data folder:</strong> ${escapeHtml(state.dataDir)}</p>
                        <pre class="status-output">${escapeHtml(status)}</pre>
                    </div>
                    <div class="commit-box">
                        <label class="field">
                            <span>Commit message</span>
                            <input class="input" type="text" value="${fieldValue(state.commitMessage)}" data-commit-message>
                        </label>
                        <label class="check-row">
                            <input type="checkbox" ${state.deleteRemovedFiles ? "checked" : ""} data-delete-removed>
                            <span>Delete removed level files</span>
                        </label>
                        <button class="button primary" type="button" data-action="save">Save JSON locally</button>
                        <button class="button blue" type="button" data-action="commit">Save and commit data</button>
                        <button class="button blue" type="button" data-action="push">Push current branch</button>
                    </div>
                </div>
            </section>
        </main>
    `;
}

function moveItem(items, index, direction) {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= items.length) {
        return false;
    }

    const [item] = items.splice(index, 1);
    items.splice(nextIndex, 0, item);
    return true;
}

function currentLevelOrThrow() {
    const level = selectedLevel();
    if (!level) {
        throw new Error("Select a level first.");
    }

    return level;
}

function serializeRecord(record) {
    const output = {
        user: String(record.user || "").trim(),
        link: String(record.link || "").trim(),
        percent: parseNumber(record.percent, 0),
        hz: parseNumber(record.hz, 0),
    };

    if (record.mobile) {
        output.mobile = true;
    }

    for (const [key, value] of Object.entries(record)) {
        if (!RECORD_KEYS.includes(key)) {
            output[key] = value;
        }
    }

    return output;
}

function serializeLevel(level) {
    let extras = {};
    try {
        extras = level.extraText.trim() ? JSON.parse(level.extraText) : {};
    } catch (error) {
        throw new Error(`${level.slug}: extra JSON fields are invalid.`);
    }

    if (!extras || typeof extras !== "object" || Array.isArray(extras)) {
        throw new Error(`${level.slug}: extra JSON fields must be an object.`);
    }

    const data = level.data;
    const output = {
        id: parseMaybeNumber(data.id),
        name: String(data.name || "").trim(),
        author: String(data.author || "").trim(),
        creators: (data.creators || [])
            .map((creator) => String(creator).trim())
            .filter(Boolean),
        verifier: String(data.verifier || "").trim(),
        verification: String(data.verification || "").trim(),
        percentToQualify: parseMaybeNumber(data.percentToQualify),
        password: String(data.password || "").trim(),
        records: (data.records || []).map(serializeRecord),
    };

    if (String(data.showcase || "").trim()) {
        output.showcase = String(data.showcase).trim();
    }

    for (const [key, value] of Object.entries(extras)) {
        if (!LEVEL_KEYS.includes(key)) {
            output[key] = value;
        }
    }

    return output;
}

function buildSavePayload() {
    const slugs = new Set();
    const levels = state.levels.map((level, index) => {
        const slug = level.slug.trim();
        if (!slug) {
            throw new Error(`Level ${index + 1} needs a file name.`);
        }

        const key = slug.toLowerCase();
        if (slugs.has(key)) {
            throw new Error(`Duplicate level file name: ${slug}`);
        }
        slugs.add(key);

        return {
            slug,
            previousSlug: level.previousSlug,
            data: serializeLevel(level),
        };
    });

    return {
        levels,
        editors: state.editors,
        deletedSlugs: Array.from(state.deletedSlugs),
        deleteRemovedFiles: state.deleteRemovedFiles,
    };
}

async function saveChanges() {
    const payload = buildSavePayload();
    setNotice("Saving JSON files...");
    const fresh = await api("/api/save", {
        method: "POST",
        body: JSON.stringify(payload),
    });
    applyState(fresh);
    state.dirty = false;
    state.deletedSlugs.clear();
    setNotice("JSON files saved.", "success");
    render();
}

async function commitChanges() {
    if (state.dirty) {
        await saveChanges();
    }

    const message = state.commitMessage.trim();
    if (!message) {
        throw new Error("Commit message is required.");
    }

    setNotice("Creating Git commit...");
    const result = await api("/api/commit", {
        method: "POST",
        body: JSON.stringify({ message }),
    });
    state.git = result.git;
    state.github = result.github || state.github;
    setNotice(
        result.output || "No data changes to commit.",
        result.committed ? "success" : "info",
    );
    render();
}

async function commitAndPushChanges() {
    if (state.dirty) {
        await saveChanges();
    }

    const message = state.commitMessage.trim();
    if (!message) {
        throw new Error("Commit message is required.");
    }

    setNotice("Creating Git commit...");
    const commit = await api("/api/commit", {
        method: "POST",
        body: JSON.stringify({ message }),
    });
    state.git = commit.git;
    state.github = commit.github || state.github;

    setNotice("Pushing current branch...");
    const push = await api("/api/push", { method: "POST" });
    state.git = push.git;
    state.github = push.github || state.github;

    const output = [commit.output, push.output].filter(Boolean).join("\n\n");
    setNotice(output || "Commit and push complete.", "success");
    render();
}
function applyState(fresh) {
    state.repoRoot = fresh.repoRoot;
    state.dataDir = fresh.dataDir;
    state.cloneRoot = fresh.cloneRoot || state.cloneRoot;
    state.levels = fresh.levels.map(normalizeLevel);
    state.editors = fresh.editors || [];
    state.git = fresh.git;
    state.github = fresh.github || state.github;
    state.repoError = fresh.repoError || "";
    state.localRepoPath = fresh.repoRoot || state.localRepoPath;
    state.selectedIndex = Math.min(
        state.selectedIndex,
        Math.max(0, state.levels.length - 1),
    );
}

async function loadState() {
    setNotice("Loading data...");
    const fresh = await api("/api/state");
    applyState(fresh);
    state.dirty = false;
    state.deletedSlugs.clear();
    setNotice("");
    render();
    await autoPullLatest();
}

async function refreshGit() {
    const result = await api("/api/status");
    state.git = result.git;
    state.github = result.github || state.github;
    setNotice("GitHub and Git status refreshed.", "success");
    render();
}

function canAutoPull() {
    const git = state.git || {};
    const github = state.github || {};
    return Boolean(
        github.authenticated &&
        git.available &&
        git.remote &&
        git.branch &&
        git.branch !== "(detached)" &&
        !state.repoError &&
        !state.dirty &&
        !(git.status && git.status.length),
    );
}

async function autoPullLatest() {
    if (state.didAutoPull) {
        return;
    }

    state.didAutoPull = true;
    if (!canAutoPull()) {
        return;
    }

    setNotice("Pulling latest commits...");
    try {
        const fresh = await api("/api/pull", { method: "POST" });
        const output = fresh.output || "Already up to date.";
        applyState(fresh);
        state.dirty = false;
        state.deletedSlugs.clear();
        setNotice(`Pulled latest on startup. ${output}`, "success");
        render();
    } catch (error) {
        setNotice(`Auto pull skipped: ${error.message}`, "error");
        render();
    }
}
async function selectRepo() {
    if (
        state.dirty &&
        !confirm("Switch repos and discard unsaved admin form changes?")
    ) {
        return;
    }

    const repoRoot = state.localRepoPath.trim();
    if (!repoRoot) {
        throw new Error("Local repo path is required.");
    }

    setNotice("Loading selected repo...");
    const fresh = await api("/api/repo/select", {
        method: "POST",
        body: JSON.stringify({ repoRoot }),
    });
    const output = fresh.output || "";
    applyState(fresh);
    state.dirty = false;
    state.deletedSlugs.clear();
    setNotice(
        output ||
            (state.repoError
                ? "Repo selected, but list data needs attention."
                : "Repo selected."),
        fresh.pullError || state.repoError ? "error" : "success",
    );
    render();
}

async function cloneRepo() {
    if (
        state.dirty &&
        !confirm(
            "Clone/select another repo and discard unsaved admin form changes?",
        )
    ) {
        return;
    }

    if (!state.repoInput.trim()) {
        throw new Error("GitHub repo is required.");
    }

    setNotice("Cloning or selecting repo...");
    const fresh = await api("/api/repo/clone", {
        method: "POST",
        body: JSON.stringify({
            repo: state.repoInput,
            localPath: state.cloneLocalPath,
        }),
    });
    const output = fresh.output || "";
    applyState(fresh);
    state.dirty = false;
    state.deletedSlugs.clear();
    setNotice(
        output || "Repo ready.",
        fresh.pullError || state.repoError ? "error" : "success",
    );
    render();
}

function clearGithubLoginTimer() {
    if (state.githubLoginTimer) {
        clearTimeout(state.githubLoginTimer);
        state.githubLoginTimer = null;
    }
}

function applyGithubLoginResult(result) {
    state.githubLoginJob = result.job || state.githubLoginJob;
    state.github = result.github || state.github;
}

function scheduleGithubLoginPoll(id) {
    clearGithubLoginTimer();
    state.githubLoginTimer = setTimeout(() => {
        pollGithubLogin(id).catch((error) => {
            clearGithubLoginTimer();
            setNotice(error.message, "error");
            render();
        });
    }, 1500);
}

async function pollGithubLogin(id) {
    const result = await api(
        `/api/github/login/status?id=${encodeURIComponent(id)}`,
    );
    applyGithubLoginResult(result);

    if (state.githubLoginJob && state.githubLoginJob.running) {
        scheduleGithubLoginPoll(id);
        render();
        return;
    }

    clearGithubLoginTimer();
    const ok = state.githubLoginJob && state.githubLoginJob.success;
    setNotice(
        ok ? "GitHub login complete." : "GitHub login did not complete.",
        ok ? "success" : "error",
    );
    render();
}

async function githubLogin() {
    clearGithubLoginTimer();
    setNotice("Starting GitHub login...");
    const result = await api("/api/github/login", { method: "POST" });
    applyGithubLoginResult(result);
    setNotice(
        "GitHub login started. Follow the GitHub CLI output shown in the Git tab.",
    );
    render();

    if (state.githubLoginJob && state.githubLoginJob.running) {
        scheduleGithubLoginPoll(state.githubLoginJob.id);
    }
}
async function pushChanges() {
    if (state.dirty) {
        await saveChanges();
    }

    setNotice("Pushing current branch...");
    const result = await api("/api/push", { method: "POST" });
    state.git = result.git;
    state.github = result.github || state.github;
    setNotice(result.output || "Push complete.", "success");
    render();
}

async function pullChanges() {
    if (state.dirty) {
        if (
            !confirm(
                "Save your unsaved admin form changes before pulling latest commits?",
            )
        ) {
            return;
        }
        await saveChanges();
    }

    setNotice("Pulling latest commits...");
    const fresh = await api("/api/pull", { method: "POST" });
    const output = fresh.output || "";
    applyState(fresh);
    state.dirty = false;
    state.deletedSlugs.clear();
    setNotice(output || "Pull complete.", "success");
    render();
}

function handleInput(event) {
    const target = event.target;
    const level = selectedLevel();

    if (target.matches("[data-level-slug]") && level) {
        level.slug = target.value;
        markDirty();
        return;
    }

    if (target.matches("[data-level-field]") && level) {
        const field = target.dataset.levelField;
        level.data[field] = target.value;
        markDirty();
        return;
    }

    if (target.matches("[data-creator-index]") && level) {
        level.data.creators[Number(target.dataset.creatorIndex)] = target.value;
        markDirty();
        return;
    }

    if (target.matches("[data-record-field]") && level) {
        const record = level.data.records[Number(target.dataset.index)];
        const field = target.dataset.recordField;
        record[field] =
            target.type === "checkbox" ? target.checked : target.value;
        markDirty();
        return;
    }

    if (target.matches("[data-editor-field]")) {
        const editor = state.editors[Number(target.dataset.index)];
        editor[target.dataset.editorField] = target.value;
        markDirty();
        return;
    }

    if (target.matches("[data-extra-json]") && level) {
        level.extraText = target.value;
        try {
            const parsed = target.value.trim() ? JSON.parse(target.value) : {};
            if (
                !parsed ||
                typeof parsed !== "object" ||
                Array.isArray(parsed)
            ) {
                throw new Error("Extra JSON must be an object.");
            }
            target.setCustomValidity("");
        } catch (error) {
            target.setCustomValidity(error.message);
        }
        markDirty();
        return;
    }

    if (target.matches("[data-commit-message]")) {
        state.commitMessage = target.value;
        return;
    }

    if (target.matches("[data-local-repo-path]")) {
        state.localRepoPath = target.value;
        return;
    }

    if (target.matches("[data-repo-input]")) {
        state.repoInput = target.value;
        return;
    }

    if (target.matches("[data-clone-local-path]")) {
        state.cloneLocalPath = target.value;
        return;
    }

    if (target.matches("[data-delete-removed]")) {
        state.deleteRemovedFiles = target.checked;
        markDirty();
    }
}

async function handleClick(event) {
    const button = event.target.closest("button[data-action]");
    if (!button) {
        return;
    }

    const action = button.dataset.action;

    try {
        if (action === "tab") {
            state.activeTab = button.dataset.tab;
            render();
            return;
        }

        if (action === "select-level") {
            state.selectedIndex = Number(button.dataset.index);
            render();
            return;
        }

        if (action === "add-level") {
            const slug = uniqueSlug("NewLevel");
            state.levels.push({
                slug,
                previousSlug: "",
                error: "",
                data: defaultLevelData("New Level"),
                extraText: "{}",
            });
            state.selectedIndex = state.levels.length - 1;
            state.activeTab = "levels";
            markDirty();
            render();
            return;
        }

        if (action === "remove-level") {
            const index = Number(button.dataset.index);
            const level = state.levels[index];
            if (
                !level ||
                !confirm(
                    `Remove ${level.data.name || level.slug} from the list?`,
                )
            ) {
                return;
            }

            if (level.previousSlug) {
                state.deletedSlugs.add(level.previousSlug);
            }
            if (level.slug && level.slug !== level.previousSlug) {
                state.deletedSlugs.add(level.slug);
            }

            state.levels.splice(index, 1);
            state.selectedIndex = Math.min(
                index,
                Math.max(0, state.levels.length - 1),
            );
            markDirty();
            render();
            return;
        }

        if (action === "move-level") {
            const index = Number(button.dataset.index);
            const direction = Number(button.dataset.direction);
            if (moveItem(state.levels, index, direction)) {
                state.selectedIndex = index + direction;
                markDirty();
                render();
            }
            return;
        }

        if (action === "move-to-rank") {
            const input = document.querySelector("[data-rank-input]");
            const targetRank = Math.max(
                1,
                Math.min(state.levels.length, Number(input.value || 1)),
            );
            const [level] = state.levels.splice(state.selectedIndex, 1);
            state.levels.splice(targetRank - 1, 0, level);
            state.selectedIndex = targetRank - 1;
            markDirty();
            render();
            return;
        }

        if (action === "add-creator") {
            currentLevelOrThrow().data.creators.push("");
            markDirty();
            render();
            return;
        }

        if (action === "remove-creator") {
            currentLevelOrThrow().data.creators.splice(
                Number(button.dataset.index),
                1,
            );
            markDirty();
            render();
            return;
        }

        if (action === "add-record") {
            currentLevelOrThrow().data.records.push({
                user: "",
                link: "",
                percent: 100,
                hz: 240,
            });
            markDirty();
            render();
            return;
        }

        if (action === "remove-record") {
            currentLevelOrThrow().data.records.splice(
                Number(button.dataset.index),
                1,
            );
            markDirty();
            render();
            return;
        }

        if (action === "move-record") {
            const records = currentLevelOrThrow().data.records;
            if (
                moveItem(
                    records,
                    Number(button.dataset.index),
                    Number(button.dataset.direction),
                )
            ) {
                markDirty();
                render();
            }
            return;
        }

        if (action === "add-editor") {
            state.editors.push({ role: "helper", name: "", link: "" });
            markDirty();
            render();
            return;
        }

        if (action === "remove-editor") {
            state.editors.splice(Number(button.dataset.index), 1);
            markDirty();
            render();
            return;
        }

        if (action === "move-editor") {
            if (
                moveItem(
                    state.editors,
                    Number(button.dataset.index),
                    Number(button.dataset.direction),
                )
            ) {
                markDirty();
                render();
            }
            return;
        }

        if (action === "sort-editors") {
            state.editors = state.editors
                .map((editor, index) => ({ editor, index }))
                .sort((a, b) => {
                    const aRole = EDITOR_ROLES.indexOf(a.editor.role);
                    const bRole = EDITOR_ROLES.indexOf(b.editor.role);
                    const aRank = aRole === -1 ? EDITOR_ROLES.length : aRole;
                    const bRank = bRole === -1 ? EDITOR_ROLES.length : bRole;
                    return aRank - bRank || a.index - b.index;
                })
                .map((item) => item.editor);
            markDirty();
            render();
            return;
        }

        if (action === "reload") {
            if (
                state.dirty &&
                !confirm("Reload and discard unsaved admin form changes?")
            ) {
                return;
            }
            await loadState();
            return;
        }

        if (action === "save") {
            await saveChanges();
            return;
        }

        if (action === "commit") {
            await commitChanges();
            return;
        }

        if (action === "commit-push") {
            await commitAndPushChanges();
            return;
        }

        if (action === "select-repo") {
            await selectRepo();
            return;
        }

        if (action === "clone-repo") {
            await cloneRepo();
            return;
        }

        if (action === "github-login") {
            await githubLogin();
            return;
        }

        if (action === "push") {
            await pushChanges();
            return;
        }

        if (action === "pull") {
            await pullChanges();
            return;
        }

        if (action === "refresh-git") {
            await refreshGit();
        }
    } catch (error) {
        setNotice(error.message, "error");
        const invalid = document.querySelector(":invalid");
        if (invalid) {
            invalid.reportValidity();
        }
    }
}

document.addEventListener("input", handleInput);
document.addEventListener("change", handleInput);
document.addEventListener("click", handleClick);

loadState().catch((error) => {
    app.innerHTML = `
        <main class="boot">
            <h1>Shitty List Template Admin Panel</h1>
            <p class="error-text">${escapeHtml(error.message)}</p>
        </main>
    `;
});
