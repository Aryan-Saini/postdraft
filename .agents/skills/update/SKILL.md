---
name: update
description: Pull the latest upstream postplan (t3dotgg, MIT) into this fork and keep postdraft's changes on top. Use when the maintainer says "update", "sync upstream", "pull in Theo's changes", "is postplan ahead of us", or a new postplan version is on npm.
disable-model-invocation: true
---

# update: sync upstream postplan

postdraft is a fork of [postplan](https://www.npmjs.com/package/postplan). Upstream has no public
git repo, so **the npm tarball is the source**. Every upstream release is committed untouched to
the `upstream` branch, then merged into a branch off `main`. Git does a real three-way merge:
only what Theo changed since the last sync gets applied, and conflicts land exactly where both
sides touched the same lines.

```
upstream:  0.0.4 (7a0df5f) ── 0.0.5 ── 0.0.6 ...      tarball contents only, never edited
              \                 \
main:          postdraft ... ─── merge ── ...
```

`7a0df5f` ("vendor: postplan 0.0.4 from npm, unmodified") is the root of both branches, which is
what makes the merge base correct.

## 1. Is there anything new?

```bash
git fetch origin
git rev-parse --verify -q origin/upstream || git push origin 7a0df5f:refs/heads/upstream  # first run only
latest=$(npm view postplan version)
synced=$(git log -1 --format=%s origin/upstream)   # "vendor: postplan X from npm, unmodified"
echo "upstream $latest, synced: $synced"
```

Same version: report "up to date" and stop.

## 2. Commit the new tarball to `upstream`

The tarball is someone else's code. Unpack it in a fresh empty dir, never run its scripts, and
look at its `package.json` `scripts` before going on (a new `postinstall` is a stop-and-ask).

```bash
t=$(mktemp -d); (cd "$t" && npm pack "postplan@$latest" --ignore-scripts -q && tar xzf postplan-*.tgz)
git worktree add /tmp/postplan-upstream origin/upstream -B upstream
cd /tmp/postplan-upstream
git ls-files | grep -vx .gitignore | xargs rm -f
cp -R "$t/package/." .
git add -A && git commit -m "vendor: postplan $latest from npm, unmodified"
git push origin upstream
cd - && git worktree remove /tmp/postplan-upstream
```

Never edit anything on `upstream` by hand. If a vendor commit is wrong, redo it.

## 3. Merge onto `main`

```bash
git switch main && git pull --ff-only
git switch -c "chore/upstream-postplan-$latest"
git diff --stat <previous vendor commit> upstream     # what Theo changed: read all of it
git merge upstream --no-ff -m "chore: merge upstream postplan $latest"
```

Resolve conflicts by intent, not by side. postdraft's layers win; upstream's fixes get ported:

| upstream touched | do |
| --- | --- |
| `src/html-policy.js` | **Always take security tightening.** Keep the `TextEncoder` swap (Convex is V8 with no `Buffer`). The server enforces this file, so a missed fix is a hole on our origin. |
| `bin/postplan.js`, `src/config.js` | Take new commands, flags and bug fixes. Keep the `postdraft` name, our `render`/`skills`/`asset` commands and the config lookup order (`--api-url`, `POSTPLAN_API_URL`, `~/.postplan/config.json`). |
| `src/api.js`, `src/db.js`, `src/storage.js`, `src/server.js`, other express/Postgres/S3 server files | We deleted these: keep them deleted (`git rm` on modify/delete conflicts). Read upstream's diff first. A new endpoint or a changed response shape must be rebuilt in `convex/` with the same contract, or the CLI breaks. |
| `package.json` | Keep ours (name, bin, `files`, scripts, deps). Add a dependency only if the merged code imports it. Never take upstream's `version`. |
| `skills/` | Keep ours. Upstream's skills of the same name (`html-communication`) do not overwrite ours. Port any rule worth having into our SKILL.md, and drop upstream-only skills that point at postplan.dev. |
| `README.md` | Keep ours. Mention notable upstream features in the right section if we took them. |

Anything you take that changes behaviour gets a test in `test/`.

## 4. Check, then hand back

```bash
pnpm install && pnpm test
npm pack --dry-run          # file list still only bin, src, skills, LICENSE, README.md
gitleaks git --no-banner --log-opts="origin/main..HEAD" 2>/dev/null || git diff origin/main --stat
git diff origin/main | grep -nE '\.convex\.(site|cloud)|AKIA|sk_live|npm_[A-Za-z0-9]{20}' && echo STOP
```

Upstream code is public, but the merge commit is ours: no deployment names, bucket names or keys
(see the warning at the top of `AGENTS.md`).

Open a PR (file-pr skill) titled `chore: sync upstream postplan <version>`. In the body list what
upstream changed, what was taken, what was skipped and why, and whether `convex/` changed.

**Do not deploy or release from this skill.** If `convex/` changed, the maintainer runs
`pnpm deploy` after merge (prod is the only environment). Publishing is `pnpm release` on a clean
`main`.
