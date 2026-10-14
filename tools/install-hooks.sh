#!/bin/sh
# Installs the pre-commit hook that stamps version.json on every commit.
cd "$(git rev-parse --show-toplevel)" || exit 1
cat > .git/hooks/pre-commit <<"EOF"
#!/bin/sh
node tools/stamp.js >/dev/null && git add version.json
EOF
chmod +x .git/hooks/pre-commit
echo "pre-commit hook installed"
