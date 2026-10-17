#!/bin/sh
# Installs the pre-commit hook: stamps version.json and copies core.js into server/ (Railway ships
# server/ alone, and the leaderboard API replays games with it). Works from a worktree too.
cd "$(git rev-parse --show-toplevel)" || exit 1
HOOKS="$(git rev-parse --git-path hooks)"
mkdir -p "$HOOKS"
cat > "$HOOKS/pre-commit" <<"EOF"
#!/bin/sh
node tools/stamp.js >/dev/null && git add version.json
cp core.js server/core.js && git add server/core.js
EOF
chmod +x "$HOOKS/pre-commit"
echo "pre-commit hook installed in $HOOKS"
