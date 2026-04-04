"use strict";

/**
 * Liquidsoap extension for Nova.
 * Provides: formatting, syntax validation.
 */

var formatDisposable = null;
var issueDisposable = null;
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

function formatDocument(editor) {
    var document = editor.document;
    var fullRange = new Range(0, document.length);
    var originalText = editor.getTextInRange(fullRange);

    if (!originalText || originalText.trim().length === 0) {
        return Promise.resolve();
    }

    var prettierPath = nova.config.get("liquidsoap.prettierPath");
    var usePrettierPath = prettierPath && prettierPath.trim().length > 0;

    var cmd, args;
    if (usePrettierPath) {
        cmd = prettierPath.trim();
        args = [
            "--plugin", "liquidsoap-prettier",
            "--parser", "liquidsoap",
            "--stdin-filepath", "file.liq",
        ];
    } else {
        cmd = "/usr/bin/env";
        args = [
            "npx", "--yes", "prettier",
            "--plugin", "liquidsoap-prettier",
            "--parser", "liquidsoap",
            "--stdin-filepath", "file.liq",
        ];
    }

    return new Promise(function (resolve, reject) {
        var process = new Process(cmd, {
            args: args,
            stdio: "pipe",
            cwd: nova.workspace.path || undefined,
        });

        var stdout = "";
        var stderr = "";

        process.onStdout(function (line) { stdout += line; });
        process.onStderr(function (line) { stderr += line; });

        process.onDidExit(function (status) {
            if (status === 0 && stdout.length > 0) {
                if (stdout !== originalText) {
                    editor.edit(function (edit) {
                        edit.replace(fullRange, stdout);
                    }).then(resolve, reject);
                } else {
                    resolve();
                }
            } else {
                if (stderr) {
                    console.error("Liquidsoap formatter error: " + stderr);
                }
                resolve();
            }
        });

        process.start();

        var writer = process.stdin.getWriter();
        writer.write(originalText);
        writer.close();
    });
}
