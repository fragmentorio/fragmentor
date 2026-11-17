# CLAUDE.md

The open-source build engine for Fragmentor, published to npm as `fragmentor`. Read [README.md](README.md) first for what it does and how it's used.

**Every rule in this file is binding.** Never break one silently, whether the user asks for it or you think breaking it is the better call. Stop first and ask the user to confirm. A yes covers only that one case and doesn't change the rule; changing the rule means editing this file.

## Editing this file

- **Every bullet is one rule.** Write the rule short and bold, add one sentence of elaboration only if needed, then an example. Example: `- **Compose with children.** The caller decides order and content. Example: ...`
- **No nested bullets.** A rule with sub-points becomes several rules. Example: "functions are verbs" and "predicates start with `is`" can share one rule, but not as sub-bullets.
- **State each rule once.** Before adding a rule, extend the one that already covers it. Example: the problem-reporting rule covers both errors and warnings, so there's no separate rule per kind.
- **Mention folders only in a Folders section.** Folders change, so rules describe the kind of code instead. Example: "the build pipeline", not "code in `src/build/`".

## Folders

- **`src/build/`** is the pipeline that turns sources into a site: `source`, `decode`, `sanitize`, `validate`, `lint`, `resolve`, `compile`, `optimize`, plus `encode` for the way back.
- **`src/model/`** holds the zod schemas and types of the data model.
- **`src/sync/`** pulls and pushes documents from and to external APIs.
- **`src/cli/`** is the `fragmentor` command: one file per command, loaded on demand.
- **`src/utils/`** holds small helpers shared across the rest.

## Commands

- **Build with `npm run build` and check with `npm test`.** `npm test` compiles first, then runs every `*.test.ts` through `node --test` from `dist/`. Example: run `npm test` before every commit.
- **Use `npm` for this repo.** There's a `package-lock.json`; keep it the only lockfile. Example: `npm install`, not `bun install` or `pnpm install`.

## Package

- **Only the CLI touches Node APIs.** The library also runs in the browser (the editor's live preview), so the pipeline, model, sync and utilities never import `node:*` and never touch the filesystem. Example: `compile` takes sources and a `parse` function, and returns output files; the CLI reads and writes them.
- **Keep the build deterministic.** Anything that changes between runs comes in from the caller. Example: `compile` takes `published` as an option instead of calling `new Date()`.
- **Keep esbuild and sharp optional.** Load them with a dynamic `import()` that falls back when they're missing, and never import them statically. Example: `optimize` skips minifying when `await import("esbuild").catch(() => null)` is null.
- **Add a runtime dependency only when there's no reasonable way without it.** Every dependency ships to every user and to the browser. Example: path handling stays in our own utilities, not a new package.
- **Export only what the public entry point lists.** Anything new that users need is added there under the matching group, and everything else stays internal. Example: a new pipeline stage gets a line under `/* Build */` in the entry point.
- **Use `.js` extensions in relative imports.** The project compiles as Node16 ES modules. Example: `import { parse } from "../../utils/path.js";`.

## Code

- **Report problems through the shared `error` and `warning` helpers.** With an `errors` or `warnings` array the problem is collected and the function carries on with a fallback value; without one, an error throws. Example: `return error(\`Expected string, got ${typeof input}\`, field.default, errors);`.
- **Read leniently, write strictly.** Reads collect problems and replace invalid values with defaults so one bad field doesn't drop a page; writes refuse invalid data. Example: `read.document` fills in a default for a bad field, `write.document` throws.
- **Write the zod schema; derive the type from it.** Schemas are the source of truth. Example: `export type Document = z.infer<typeof DocumentSchema> & { _type: T };`.
- **Name things with short, plain words.** Functions are verbs or nouns for what they return, predicates start with `is`. Example: `decode`, `entry`, `declared`, `isDocument`.
- **Document every exported function with JSDoc that says what it does and gives an `@example`.** Internal helpers get one `/* ... */` line. Example: the JSDoc above `decode`, and `/* The file's data with the Source's own _ fields on top */` above `overlay`.
- **Use a `Map` for lookups keyed by user input.** A plain object lets keys like `constructor` reach `Object.prototype`. Example: the decoder table is a `Map` from extension to decoder.

## Tests

- **Put tests next to the code, one `*.test.ts` per pipeline stage.** Use `node:test` and `node:assert/strict`; no test framework. Example: `decode.test.ts` sits beside the decoders.
- **Name each test `"<function>: <behavior>"`.** The behavior is a plain sentence that states what should happen. Example: `"decode: a file that doesn't parse is just its _ fields"`.
- **Add a test with every bug fix and every new behavior.** Example: a fix for an extension named `constructor` comes with a test that decodes `a.constructor`.

## Branches

- **Never commit to `main`.** `main` is always releasable and changes reach it only through a pull request. Example: start every change with `git switch -c feat/dev-live-reload origin/main`.
- **One branch per feature or fix, cut from an up-to-date `main`.** Run `git fetch` first, and keep the branch small enough to review in one sitting. Example: live reload and colored CLI errors are two branches, not one.
- **Name branches `<type>/<description>`, in lowercase kebab-case.** The type is one of the commit types below; the description is two to four words. Example: `feat/dev-live-reload`, `fix/decode-prototype-keys`, `docs/claude-md`.
- **Branch in a new worktree when the checkout has changes you didn't make.** Switching branches would carry another agent's uncommitted work along. Example: `git worktree add ../fragmentor-live-reload -b feat/dev-live-reload origin/main`.
- **Rebase onto `main` instead of merging `main` in.** Force-push your own branch only with `--force-with-lease`. Example: `git fetch && git rebase origin/main`, never `git merge main`.

## Commits

- **Make each commit one logical change.** Commit as you go, not once at the end; every commit should pass `npm test` so it can be reverted or bisected on its own. Example: "add live reload" and "color CLI errors" are two commits; a typo fix in an unrelated file is a third.
- **Write messages as [Conventional Commits](https://www.conventionalcommits.org): `<type>(<scope>): <description>`.** The scope is the area: `build`, `model`, `sync`, `cli` or `utils`; leave it out for repo-root files. Example: `feat(cli): reload the page when the dev build changes`, `docs: add CLAUDE.md`.
- **Use the standard types.** That's `feat`, `fix`, `refactor`, `perf`, `test`, `docs`, `build`, `ci`, `chore` and `revert`. Example: a dependency bump is `build: bump zod to 4.4.3`, not `chore: update stuff`.
- **Write the description in the imperative, lowercase, under 72 characters, with no trailing period.** It completes "If applied, this commit will…". Example: `fix(build): keep hidden documents in dev builds`, not `Fixed hidden docs.`.
- **Put the why in the body.** Leave a blank line after the subject and explain the reasoning and rejected alternatives; the diff already shows what changed. Example: `A Map, so an extension like "constructor" can't reach Object.prototype.`
- **Mark breaking changes with `!` and a `BREAKING CHANGE:` footer.** That covers anything that changes the public API, the CLI or the file format users depend on. Example: `feat(build)!: return errors grouped by file`.

## Pull requests

- **Open a pull request when the branch is done, and never merge it yourself.** Run `npm test` first, push, then open it with `gh pr create`. Example: `npm test && git push -u origin HEAD && gh pr create`.
- **Title the PR like a commit message.** Example: `feat(cli): reload the page when the dev build changes`.
- **Describe the change for a reviewer.** Write a short summary of what and why, then a test plan of what you ran and what you checked by hand. Example: `Ran npm test; started npx fragmentor dev in a sample project and saw it reload on save.`
- **Address review feedback with new commits.** Rewrite history only by rebasing onto `main`, so reviewers can see what changed since their last look. Example: `fix(cli): debounce rebuilds on rapid saves` as a follow-up commit.

## Safety

- **Never delete local code you didn't write.** Other agents may be working in this repo at the same time. Example: never `git reset --hard`, `git checkout -- .` or similar.
