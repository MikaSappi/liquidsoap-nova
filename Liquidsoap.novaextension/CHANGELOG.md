## 30 APRIL 2026
Port grammar coverage from the upstream VSCode extension: time predicates (1h30m), doc tags inside comments (@param, @category, @argsof, @flag, @docof), string interpolation #{...}, dereference operator !ident, dotted arithmetic +. -. *. /., let pattern bindings, let json.parse / yaml.parse, and for-loop variable capture.
Add cross-file completions: scan sibling .liq files in the same directory and suggest their top-level def/let/assignment names. Cached per-file by mtime. Toggle via the new "liquidsoap.crossFileCompletions" setting (default enabled, with a per-workspace override).

## 08 APRIL 2026
Fix a bug that led to some expressions being interpreted as other types.

## 04 APRIL 2026
Initial commit.
