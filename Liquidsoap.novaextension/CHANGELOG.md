## 02 MAY 2026
Index top-level `name = …` assignments as variable symbols, so they show up in the dictionary / completion suggestions alongside `def` and `let` bindings.
Fix `%`-prefixed completions (e.g. `%wav`, `%mp3`) doubling the sigil to `%%wav` when accepted — the completion provider now matches the leading `%` so the inserted text overwrites it instead of stacking on top.

## 30 APRIL 2026
Port grammar coverage from the upstream VSCode extension: time predicates (1h30m), doc tags inside comments (@param, @category, @argsof, @flag, @docof), string interpolation #{...}, dereference operator !ident, dotted arithmetic +. -. *. /., let pattern bindings, let json.parse / yaml.parse, and for-loop variable capture.
Add cross-file completions: scan sibling .liq files in the same directory and suggest their top-level def/let/assignment names. Cached per-file by mtime. Toggle via the new "liquidsoap.crossFileCompletions" setting (default enabled, with a per-workspace override).

## 08 APRIL 2026
Fix a bug that led to some expressions being interpreted as other types.

## 04 APRIL 2026
Initial commit.
