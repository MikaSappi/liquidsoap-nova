"use strict";

/**
 * Liquidsoap extension for Nova.
 * Provides: formatting, syntax validation.
 */

var formatDisposable = null;
var issueDisposable = null;
var completionDisposable = null;
var saveDisposables = [];

exports.activate = function () {
    formatDisposable = nova.commands.register(
        "liquidsoap.format",
        formatDocument
    );

    issueDisposable = nova.assistants.registerIssueAssistant(
        "liquidsoap",
        new LiquidsoapIssueAssistant(),
        { event: "onChange" }
    );

    completionDisposable = nova.assistants.registerCompletionAssistant(
        "liquidsoap",
        new LiquidsoapCompletionAssistant()
    );

    nova.workspace.onDidAddTextEditor(function (editor) {
        if (editor.document.syntax === "liquidsoap") {
            var disposable = editor.onWillSave(function (editor) {
                if (shouldFormatOnSave()) {
                    return formatDocument(editor);
                }
            });
            saveDisposables.push(disposable);
        }
    });
};

exports.deactivate = function () {
    if (formatDisposable) {
        formatDisposable.dispose();
        formatDisposable = null;
    }
    if (issueDisposable) {
        issueDisposable.dispose();
        issueDisposable = null;
    }
    if (completionDisposable) {
        completionDisposable.dispose();
        completionDisposable = null;
    }
    saveDisposables.forEach(function (d) { d.dispose(); });
    saveDisposables = [];
};

// ==================== ISSUE ASSISTANT ====================

// Block-opening keywords that require a matching 'end'
var BLOCK_OPENERS = ["def", "if", "for", "while", "try", "begin"];

// Keywords only valid inside specific blocks
var BLOCK_CONTEXT = {
    "then": ["if"],
    "elsif": ["if"],
    "else": ["if", "try"],
    "do": ["for", "while"],
    "to": ["for"],
    "catch": ["try"],
    "finally": ["try"]
};

function LiquidsoapIssueAssistant() {}

LiquidsoapIssueAssistant.prototype.provideIssues = function (editor) {
    var document = editor.document;
    var fullRange = new Range(0, document.length);
    var text = editor.getTextInRange(fullRange);

    if (!text || text.trim().length === 0) {
        return [];
    }

    var lines = text.split("\n");
    var issues = [];
    var blockStack = [];
    var parenStack = [];

    // State tracking
    var inBlockComment = false;
    var blockCommentStartLine = 0;
    var inString = false;
    var stringChar = "";
    var stringStartLine = 0;

    for (var i = 0; i < lines.length; i++) {
        var line = lines[i];
        var lineNum = i + 1;

        for (var c = 0; c < line.length; c++) {
            var ch = line[c];
            var next = c + 1 < line.length ? line[c + 1] : "";
            var prev = c > 0 ? line[c - 1] : "";

            // --- Block comment state ---
            if (inBlockComment) {
                if (ch === ">" && next === "#") {
                    inBlockComment = false;
                    c++;
                }
                continue;
            }

            // --- String state ---
            if (inString) {
                if (ch === "\\") {
                    c++;
                    continue;
                }
                if (ch === stringChar) {
                    inString = false;
                }
                continue;
            }

            // --- Start block comment ---
            if (ch === "#" && next === "<") {
                inBlockComment = true;
                blockCommentStartLine = lineNum;
                c++;
                continue;
            }

            // --- Single-line comment: skip rest of line ---
            if (ch === "#") {
                break;
            }

            // --- Start string ---
            if (ch === '"' || ch === "'") {
                inString = true;
                stringChar = ch;
                stringStartLine = lineNum;
                continue;
            }

            // --- Bracket tracking ---
            if (ch === "(" || ch === "[" || ch === "{") {
                parenStack.push({ char: ch, line: lineNum, col: c + 1 });
                continue;
            }
            if (ch === ")" || ch === "]" || ch === "}") {
                var expected = ch === ")" ? "(" : (ch === "]" ? "[" : "{");
                if (parenStack.length === 0) {
                    var issue = new Issue();
                    issue.message = "Unexpected '" + ch + "' without matching '" + expected + "'";
                    issue.severity = IssueSeverity.Error;
                    issue.line = lineNum;
                    issue.column = c + 1;
                    issue.source = "Liquidsoap";
                    issues.push(issue);
                } else {
                    var top = parenStack[parenStack.length - 1];
                    if (top.char !== expected) {
                        var issue = new Issue();
                        issue.message = "Mismatched bracket: expected '" +
                            (top.char === "(" ? ")" : (top.char === "[" ? "]" : "}")) +
                            "' to close '" + top.char + "' from line " + top.line +
                            ", but found '" + ch + "'";
                        issue.severity = IssueSeverity.Error;
                        issue.line = lineNum;
                        issue.column = c + 1;
                        issue.source = "Liquidsoap";
                        issues.push(issue);
                    }
                    parenStack.pop();
                }
                continue;
            }

            // --- Keyword tracking ---
            if (/[a-zA-Z_]/.test(ch)) {
                var wordMatch = line.substring(c).match(/^([a-zA-Z_][a-zA-Z0-9_]*)/);
                if (wordMatch) {
                    var word = wordMatch[1];
                    var wordCol = c + 1;
                    c += word.length - 1;

                    // Block openers
                    if (BLOCK_OPENERS.indexOf(word) !== -1) {
                        blockStack.push({ keyword: word, line: lineNum, col: wordCol });
                    }
                    // 'end' closes the most recent block
                    else if (word === "end") {
                        if (blockStack.length === 0) {
                            var issue = new Issue();
                            issue.message = "Unexpected 'end' without matching block opener";
                            issue.severity = IssueSeverity.Error;
                            issue.line = lineNum;
                            issue.column = wordCol;
                            issue.source = "Liquidsoap";
                            issues.push(issue);
                        } else {
                            blockStack.pop();
                        }
                    }
                    // Context-sensitive keywords
                    else if (BLOCK_CONTEXT[word]) {
                        var validParents = BLOCK_CONTEXT[word];
                        var found = false;
                        for (var s = blockStack.length - 1; s >= 0; s--) {
                            if (validParents.indexOf(blockStack[s].keyword) !== -1) {
                                found = true;
                                break;
                            }
                        }
                        if (!found && blockStack.length > 0) {
                            var issue = new Issue();
                            issue.message = "'" + word + "' is not valid here (expected inside '" +
                                validParents.join("' or '") + "' block)";
                            issue.severity = IssueSeverity.Warning;
                            issue.line = lineNum;
                            issue.column = wordCol;
                            issue.source = "Liquidsoap";
                            issues.push(issue);
                        }
                    }
                }
            }
        }
    }

    // --- Post-scan checks ---

    // Unclosed block comment
    if (inBlockComment) {
        var issue = new Issue();
        issue.message = "Unclosed block comment opened on line " + blockCommentStartLine + " (missing >#)";
        issue.severity = IssueSeverity.Error;
        issue.line = blockCommentStartLine;
        issue.source = "Liquidsoap";
        issues.push(issue);
    }

    // Unclosed string
    if (inString) {
        var issue = new Issue();
        issue.message = "Unclosed string literal opened on line " + stringStartLine;
        issue.severity = IssueSeverity.Error;
        issue.line = stringStartLine;
        issue.source = "Liquidsoap";
        issues.push(issue);
    }

    // Unclosed blocks
    for (var b = 0; b < blockStack.length; b++) {
        var block = blockStack[b];
        var issue = new Issue();
        issue.message = "'" + block.keyword + "' has no matching 'end'";
        issue.severity = IssueSeverity.Error;
        issue.line = block.line;
        issue.column = block.col;
        issue.source = "Liquidsoap";
        issues.push(issue);
    }

    // Unclosed brackets
    for (var p = 0; p < parenStack.length; p++) {
        var paren = parenStack[p];
        var closeChar = paren.char === "(" ? ")" : (paren.char === "[" ? "]" : "}");
        var issue = new Issue();
        issue.message = "Unclosed '" + paren.char + "' (missing '" + closeChar + "')";
        issue.severity = IssueSeverity.Error;
        issue.line = paren.line;
        issue.column = paren.col;
        issue.source = "Liquidsoap";
        issues.push(issue);
    }

    return issues;
};

// ==================== FORMAT ON SAVE ====================

function shouldFormatOnSave() {
    var workspaceSetting = nova.workspace.config.get("liquidsoap.formatOnSave");
    if (workspaceSetting === "Enable") return true;
    if (workspaceSetting === "Disable") return false;
    return nova.config.get("liquidsoap.formatOnSave") === true;
}

// ==================== FORMATTER ====================
//
// Design notes:
//
// Nova's Process API does NOT inherit the user's interactive shell PATH.
// Tools installed by nvm, Homebrew, Volta, asdf, etc. live outside the
// minimal PATH Nova sees, so spawning "npx" directly fails with
// "env: npx: No such file or directory". Every shell-out therefore goes
// through `$SHELL -l -c …` so rc files and version managers initialise.
//
// For plugin discovery, relying on `npx --package foo --package bar` is
// not enough: prettier v3 resolves plugins by doing ESM import from its
// current working directory, which is the user's workspace — NOT the
// npx sandbox — so the plugin in the sandbox is invisible. Instead we
// maintain our own small `node_modules` under `~/Library/Caches/…`, run
// `npm install …@latest` there, and invoke prettier with cwd set to
// that cache dir. That makes prettier's cwd-anchored plugin resolution
// find `liquidsoap-prettier` immediately, and lets us update
// independently of whatever the user has installed elsewhere.

// How often to re-run `npm install @latest` to pick up new releases.
var FORMATTER_UPDATE_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24h

// Shell-quote a string for safe interpolation into a shell command.
function shellQuote(s) {
    return "'" + String(s).replace(/'/g, "'\\''") + "'";
}

function getUserShell() {
    return nova.environment.SHELL || "/bin/zsh";
}

function getFormatterCacheDir() {
    // Prefer Nova's per-extension storage when available, fall back to
    // a stable path under the user's Caches dir.
    if (nova.extension && typeof nova.extension.globalStoragePath === "string") {
        return nova.extension.globalStoragePath + "/formatter";
    }
    var home = nova.environment.HOME || "/tmp";
    return home + "/Library/Caches/com.fremen.liquidsoap/formatter";
}

function formatterIsInstalled(cacheDir) {
    return nova.fs.access(
        cacheDir + "/node_modules/liquidsoap-prettier/package.json",
        nova.fs.F_OK
    );
}

function formatterLastUpdateMs(cacheDir) {
    var marker = cacheDir + "/.last-update";
    if (!nova.fs.access(marker, nova.fs.F_OK)) return 0;
    try {
        var stats = nova.fs.stat(marker);
        if (stats && stats.mtime) return stats.mtime.getTime();
    } catch (e) {
        // fall through
    }
    return 0;
}

// Run `npm install liquidsoap-prettier@latest prettier@latest` in the
// cache dir. Creates the directory and seed package.json if missing,
// and writes a `.last-update` marker on success.
function runNpmInstall(cacheDir) {
    return new Promise(function (resolve, reject) {
        var script =
            "set -e; " +
            "mkdir -p " + shellQuote(cacheDir) + "; " +
            "cd " + shellQuote(cacheDir) + "; " +
            "[ -f package.json ] || printf '%s\\n' '{\"private\":true}' > package.json; " +
            "npm install --silent --no-audit --no-fund --no-progress " +
            "liquidsoap-prettier@latest prettier@latest; " +
            "touch .last-update";

        var proc;
        try {
            proc = new Process(getUserShell(), {
                args: ["-l", "-c", script],
                stdio: "pipe",
                cwd: nova.environment.HOME || undefined,
            });
        } catch (e) {
            reject(e);
            return;
        }

        var stderr = "";
        proc.onStderr(function (line) { stderr += line; });
        proc.onDidExit(function (status) {
            if (status === 0) {
                resolve();
            } else {
                reject(new Error(
                    "npm install exited with status " + status +
                    (stderr ? ("\n" + stderr.trim()) : "")
                ));
            }
        });

        try {
            proc.start();
        } catch (e) {
            reject(e);
        }
    });
}

// Ensures the bundled formatter is installed in the cache dir; kicks
// off a background update if the install is stale. Resolves with the
// cache dir when the formatter is ready to use.
var _installInFlight = null;
function ensureFormatter() {
    var cacheDir = getFormatterCacheDir();

    if (!formatterIsInstalled(cacheDir)) {
        // First-time install must block the format call.
        if (!_installInFlight) {
            _installInFlight = runNpmInstall(cacheDir).then(
                function () { _installInFlight = null; },
                function (err) { _installInFlight = null; throw err; }
            );
        }
        return _installInFlight.then(function () { return cacheDir; });
    }

    // Already installed — run format immediately. If stale, refresh in
    // the background so the NEXT format picks up any new release.
    var age = Date.now() - formatterLastUpdateMs(cacheDir);
    if (age > FORMATTER_UPDATE_INTERVAL_MS && !_installInFlight) {
        _installInFlight = runNpmInstall(cacheDir).then(
            function () { _installInFlight = null; },
            function (err) {
                _installInFlight = null;
                console.warn(
                    "Liquidsoap formatter background update failed: " + err.message
                );
            }
        );
        // Intentionally not awaited.
    }
    return Promise.resolve(cacheDir);
}

function runPrettier(editor, fullRange, originalText, innerCmd, cwd) {
    return new Promise(function (resolve, reject) {
        var cmd = getUserShell();
        var args = ["-l", "-c", innerCmd];
        var proc;
        try {
            proc = new Process(cmd, {
                args: args,
                stdio: "pipe",
                cwd: cwd,
            });
        } catch (e) {
            nova.workspace.showErrorMessage(
                "Liquidsoap: could not launch shell (" + cmd + "): " + e.message
            );
            resolve();
            return;
        }

        var stdout = "";
        var stderr = "";
        proc.onStdout(function (line) { stdout += line; });
        proc.onStderr(function (line) { stderr += line; });

        proc.onDidExit(function (status) {
            if (status === 0 && stdout.length > 0) {
                if (stdout !== originalText) {
                    editor.edit(function (edit) {
                        edit.replace(fullRange, stdout);
                    }).then(resolve, reject);
                } else {
                    resolve();
                }
                return;
            }

            console.error(
                "Liquidsoap formatter exited with status " + status +
                "\ncmd: " + cmd + " " + args.join(" ") +
                "\nstderr: " + stderr
            );

            var msg = (stderr && stderr.trim().length > 0)
                ? stderr.trim()
                : "Formatter exited with status " + status + " and no output.";
            if (msg.length > 600) msg = msg.slice(0, 600) + "…";
            nova.workspace.showErrorMessage("Liquidsoap formatter failed:\n\n" + msg);
            resolve();
        });

        try {
            proc.start();
        } catch (e) {
            nova.workspace.showErrorMessage(
                "Liquidsoap: failed to start formatter: " + e.message
            );
            resolve();
            return;
        }

        var writer = proc.stdin.getWriter();
        writer.write(originalText);
        writer.close();
    });
}

function formatDocument(editor) {
    var document = editor.document;
    var fullRange = new Range(0, document.length);
    var originalText = editor.getTextInRange(fullRange);

    if (!originalText || originalText.trim().length === 0) {
        return Promise.resolve();
    }

    var userPrettier = nova.config.get("liquidsoap.prettierPath");
    var usePrettierPath = userPrettier && userPrettier.trim().length > 0;
    var stdinFilepath = document.path || "file.liq";

    if (usePrettierPath) {
        // User-provided prettier: they are responsible for having
        // liquidsoap-prettier resolvable from their workspace.
        var userCmd =
            shellQuote(userPrettier.trim()) +
            " --plugin liquidsoap-prettier" +
            " --parser liquidsoap" +
            " --stdin-filepath " + shellQuote(stdinFilepath);
        return runPrettier(
            editor, fullRange, originalText,
            userCmd,
            nova.workspace.path || undefined
        );
    }

    // Bundled formatter via cache dir.
    return ensureFormatter().then(function (cacheDir) {
        // cwd = cacheDir so prettier's cwd-based ESM plugin resolution
        // finds liquidsoap-prettier in cacheDir/node_modules.
        // --stdin-filepath carries the real file path so prettier's
        // file-based config discovery / parser selection still work as
        // if the file were being edited in place.
        var bin = shellQuote(cacheDir + "/node_modules/.bin/prettier");
        var innerCmd =
            bin +
            " --plugin liquidsoap-prettier" +
            " --parser liquidsoap" +
            " --stdin-filepath " + shellQuote(stdinFilepath);
        return runPrettier(editor, fullRange, originalText, innerCmd, cacheDir);
    }, function (err) {
        console.error("Liquidsoap formatter install failed: " + err.message);
        nova.workspace.showErrorMessage(
            "Liquidsoap: could not install formatter " +
            "(prettier + liquidsoap-prettier).\n\n" +
            err.message +
            "\n\nMake sure Node.js and npm are installed and reachable from your login shell."
        );
    });
}

// ==================== CROSS-FILE COMPLETIONS ====================
//
// Scans .liq files in the same directory as the file being edited and
// surfaces their top-level `def`, `let`, and bare-assignment names as
// completion items. Cache is keyed by file path with mtime invalidation,
// so a completion request only re-reads files that actually changed.

function shouldUseCrossFileCompletions() {
    var ws = nova.workspace.config.get("liquidsoap.crossFileCompletions");
    if (ws === "Enable") return true;
    if (ws === "Disable") return false;
    // Default: enabled (only disabled if explicitly set to false globally).
    return nova.config.get("liquidsoap.crossFileCompletions") !== false;
}

// path -> { mtime: number, defs: [{ name, kind }] }
var _crossFileCache = {};

function _dirname(p) {
    var i = p.lastIndexOf("/");
    return i < 0 ? "." : p.slice(0, i);
}
function _basename(p) {
    var i = p.lastIndexOf("/");
    return i < 0 ? p : p.slice(i + 1);
}

function _mtimeMs(path) {
    try {
        var s = nova.fs.stat(path);
        if (s && s.mtime) return s.mtime.getTime();
    } catch (e) { /* fall through */ }
    return 0;
}

function _readFile(path) {
    try {
        var f = nova.fs.open(path, "r");
        var text = f.read();
        f.close();
        return typeof text === "string" ? text : null;
    } catch (e) {
        return null;
    }
}

// Extract top-level definitions from a liquidsoap source string.
// Conservative: only matches `def`/`let`/`name =` at the start of a line
// (no leading whitespace) so function-parameter defaults like `~port=8000`
// and nested defs don't pollute the suggestion list.
function _extractDefinitions(text) {
    var out = [];
    var seen = {};
    var m;

    var defRe = /^def\s+(?:rec\s+|replaces\s+)?([a-zA-Z_][a-zA-Z0-9_'.]*)/gm;
    while ((m = defRe.exec(text)) !== null) {
        if (seen[m[1]]) continue;
        seen[m[1]] = true;
        out.push({ name: m[1], kind: "function" });
    }

    var letRe = /^let\s+(?:eval\s+|replaces\s+|json\.parse(?:\[[^\]]*\])?\s+|yaml\.parse(?:\[[^\]]*\])?\s+)?([a-zA-Z_][a-zA-Z0-9_'.]*)\s*=/gm;
    while ((m = letRe.exec(text)) !== null) {
        if (seen[m[1]]) continue;
        seen[m[1]] = true;
        out.push({ name: m[1], kind: "variable" });
    }

    var assignRe = /^([a-zA-Z_][a-zA-Z0-9_']*)\s*=(?!=)/gm;
    while ((m = assignRe.exec(text)) !== null) {
        if (seen[m[1]]) continue;
        seen[m[1]] = true;
        out.push({ name: m[1], kind: "variable" });
    }

    return out;
}

function _getDefsForFile(path) {
    var mtime = _mtimeMs(path);
    if (!mtime) {
        delete _crossFileCache[path];
        return [];
    }
    var cached = _crossFileCache[path];
    if (cached && cached.mtime === mtime) return cached.defs;
    var text = _readFile(path);
    if (text === null) return [];
    var defs = _extractDefinitions(text);
    _crossFileCache[path] = { mtime: mtime, defs: defs };
    return defs;
}

function _listSiblingLiqFiles(dir, excludeBasename) {
    var entries;
    try {
        entries = nova.fs.listdir(dir);
    } catch (e) {
        return [];
    }
    var out = [];
    for (var i = 0; i < entries.length; i++) {
        var name = entries[i];
        if (name === excludeBasename) continue;
        if (name.length < 5) continue;
        if (name.slice(-4).toLowerCase() !== ".liq") continue;
        out.push(dir + "/" + name);
    }
    return out;
}

function LiquidsoapCompletionAssistant() {}

LiquidsoapCompletionAssistant.prototype.provideCompletionItems =
    function (editor, _context) {
        if (!shouldUseCrossFileCompletions()) return [];

        var docPath = editor.document.path;
        if (!docPath) return []; // unsaved document — no directory to scan

        var dir = _dirname(docPath);
        var selfBase = _basename(docPath);
        var files = _listSiblingLiqFiles(dir, selfBase);
        if (files.length === 0) return [];

        var items = [];
        var seen = {};
        for (var i = 0; i < files.length; i++) {
            var path = files[i];
            var src = _basename(path);
            var defs = _getDefsForFile(path);
            for (var j = 0; j < defs.length; j++) {
                var d = defs[j];
                if (seen[d.name]) continue;
                seen[d.name] = true;

                var kind = d.kind === "function"
                    ? CompletionItemKind.Function
                    : CompletionItemKind.Variable;
                var item = new CompletionItem(d.name, kind);
                if (d.kind === "function") {
                    item.insertText = d.name + "($0)";
                    item.insertTextFormat = InsertTextFormat.Snippet;
                }
                item.detail = src;
                item.documentation = "Defined in " + src;
                items.push(item);
            }
        }
        return items;
    };
