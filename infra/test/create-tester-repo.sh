#!/usr/bin/env bash
# Creates the private testers' repository (issue tracker only, no application code) and invites the testers.
#
#   infra/test/create-tester-repo.sh [owner/repo] [tester ...]
#
# Default repo: vasudevansundarababu-dev/adi-praxis-testing. Default testers: the Release 1.1 India test team.
# Needs the GitHub CLI signed in as a repo admin (gh auth login). Safe to re-run: it refreshes the files and
# re-sends invites; it never deletes issues or labels.
#
# The repository gets: the tester guide, test cases, decision register and sample files (docs/testing), the issue
# forms and labels, the label-sync workflow and the /verified and /failed issue commands. Testers get the Triage role.
set -euo pipefail

REPO="${1:-vasudevansundarababu-dev/adi-praxis-testing}"
shift || true
TESTERS=("$@")
[ ${#TESTERS[@]} -gt 0 ] || TESTERS=(DhruvnStore Shriya-ss10 hvenkat396-oss)
CODE_REPO="vasudevansundarababu-dev/adi-praxis"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

DRY_RUN="${DRY_RUN:-}"  # DRY_RUN=<dir>: only assemble the content into <dir>
[ -n "$DRY_RUN" ] || command -v gh >/dev/null || { echo "Install the GitHub CLI first: https://cli.github.com" >&2; exit 1; }
[ -n "$DRY_RUN" ] || gh auth status >/dev/null 2>&1 || { echo "Run 'gh auth login' first." >&2; exit 1; }

if [ -n "$DRY_RUN" ]; then WORK="$DRY_RUN"; mkdir -p "$WORK"; else WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT; fi

# 1. Assemble the repository content from the code repo (docs/testing stays the source of truth).
mkdir -p "$WORK/docs/testing" "$WORK/.github/ISSUE_TEMPLATE" "$WORK/.github/workflows"
cp "$ROOT"/docs/testing/*.md "$ROOT"/docs/testing/test-cases.csv "$WORK/docs/testing/"
cp -R "$ROOT/docs/testing/samples" "$WORK/docs/testing/"
cp "$ROOT"/.github/ISSUE_TEMPLATE/*.yml "$WORK/.github/ISSUE_TEMPLATE/"
cp "$ROOT/.github/labels.yml" "$WORK/.github/"
cp "$ROOT/.github/workflows/labels.yml" "$ROOT/.github/workflows/issue-commands.yml" "$WORK/.github/workflows/"
cp "$ROOT/SECURITY.md" "$WORK/"
# Links to the code repo (tester guide, security advisories) point at this repo instead.
grep -rlF "$CODE_REPO/" "$WORK" | while read -r f; do
  sed -i.bak "s#${CODE_REPO}/#${REPO}/#g" "$f" && rm -f "$f.bak"
done

cat > "$WORK/README.md" <<EOF
# ADI Praxis — testing

Defect tracker for the ADI Praxis test environment. There is no application code here.

1. Read the [tester guide](docs/testing/README.md) and [what's new in 1.1](docs/testing/WHATS-NEW-1.1.md).
2. Run the cases in [TEST-CASES.md](docs/testing/TEST-CASES.md) (also [test-cases.csv](docs/testing/test-cases.csv)).
   Check the [decision register](docs/testing/DECISION-REGISTER.md) before reporting agreed behaviour as a defect.
3. Report problems in **Issues → New issue** and pick a form (Defect, UX issue, Enhancement request).
   Security vulnerabilities are never issues: see [SECURITY.md](SECURITY.md).
4. When a fix is deployed, verify it and comment \`/verified\` or \`/failed\` on the issue.

Passwords come from the lead tester through the team password manager. Never put passwords, real names or real
identifiers in an issue, comment or screenshot.
EOF

[ -z "$DRY_RUN" ] || { echo "Assembled in $WORK (dry run)"; exit 0; }

# 2. Create the repository (private) if it does not exist, then push.
if ! gh repo view "$REPO" >/dev/null 2>&1; then
  gh repo create "$REPO" --private --disable-wiki --description "ADI Praxis test environment: tester guide, test cases and defect tracker"
fi
gh repo edit "$REPO" --enable-issues --enable-projects=false --enable-wiki=false >/dev/null

git -C "$WORK" init -q -b main
git -C "$WORK" add -A
git -C "$WORK" -c user.name="$(git -C "$ROOT" config user.name)" -c user.email="$(git -C "$ROOT" config user.email)" \
  commit -q -m "Tester pack from $CODE_REPO@$(git -C "$ROOT" rev-parse --short HEAD)"
git -C "$WORK" push -q --force "https://github.com/$REPO.git" main
echo "Pushed tester pack to https://github.com/$REPO"

# 3. Labels now (the workflow keeps them in sync later).
python3 - "$WORK/.github/labels.yml" "$REPO" <<'PY'
import re, subprocess, sys
for line in open(sys.argv[1]):
    m = re.match(r'\s*- \{ name: "([^"]+)", color: "([0-9a-f]{6})", description: "([^"]*)" \}', line)
    if m:
        name, color, desc = m.groups()
        subprocess.run(['gh', 'label', 'create', name, '-R', sys.argv[2], '--color', color,
                        '--description', desc[:100], '--force'], check=True, stdout=subprocess.DEVNULL)
print('labels synced')
PY

# 4. Invite the testers with the Triage role (they accept the email invite, then open issues).
for u in "${TESTERS[@]}"; do
  gh api -X PUT "repos/$REPO/collaborators/$u" -f permission=triage >/dev/null && echo "invited $u (triage)"
done

echo "Done: https://github.com/$REPO/issues — testers must accept the invite at https://github.com/$REPO/invitations"
