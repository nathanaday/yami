# Checks and releases

How each repository of the Yami ecosystem is checked and released, and how a plugin gets into a vault. One rule for all of them: **a version bump on `main` is a release.** CI checks every change; the release workflow publishes a version the first time `main` holds it, and does nothing otherwise.

| Repository | What it holds | Where it is published |
| --- | --- | --- |
| [`yami`](https://github.com/nathanaday/yami) | The library | GitHub releases `yami-X.Y.Z`, each with `yami-X.Y.Z.tgz` |
| [`yami-wiki`](https://github.com/nathanaday/yami-wiki) | Yami Wiki, the wiki plugin | GitHub releases `X.Y.Z`; the community directory once submitted |
| [`yami-threads`](https://github.com/nathanaday/yami-threads) | Yami Threads, the threads plugin | GitHub releases `X.Y.Z`; not in the directory |
| [`obsidian-duet`](https://github.com/nathanaday/obsidian-duet) | Duet, the conversation plugin | The community directory, from GitHub releases `X.Y.Z` |
| [`obsidian-almagest`](https://github.com/nathanaday/obsidian-almagest) | Almagest, at its end of life | The community directory; no further releases |

## The library

`.github/workflows/ci.yml` runs the build and the unit tests on every push to `main` and every pull request. `.github/workflows/release.yml` runs on every push to `main`: it reads `yami/package.json`, stops when the release `yami-X.Y.Z` exists, and otherwise builds, tests, packs, tags the commit, and publishes `yami-X.Y.Z.tgz`.

```sh
cd yami
npm version X.Y.Z --no-git-tag-version   # package.json and package-lock.json
# set VERSION in src/version.ts to the same, and add the entry to CHANGELOG.md
git commit -am "yami X.Y.Z" && git push
```

A plugin takes the library by the URL of that file: `"yami": "https://github.com/nathanaday/yami/releases/download/yami-X.Y.Z/yami-X.Y.Z.tgz"`. To move a plugin to a new library, change the URL in its `package.json`, run `npm install`, which records the file's hash in the lockfile, and commit both. The library release must exist before the plugin's `npm ci` can fetch it, so the order is always library first, then plugins.

## Yami Wiki and Yami Threads

Each repository has the same two workflows. `ci.yml` runs the type check, Obsidian's lint, the unit tests, and the build on every push to `main` and every pull request. `release.yml` runs on every push to `main`: it reads `manifest.json`, stops when the release `X.Y.Z` exists, and otherwise checks the plugin again, tags the commit `X.Y.Z` (no `v`), and publishes `main.js`, `manifest.json`, and `styles.css`, which Obsidian's community plugins and BRAT download.

```sh
npm run set-version X.Y.Z                # manifest.json, package.json, package-lock.json, versions.json
git commit -am "X.Y.Z" && git push
```

A unit test holds the four version files to one version. Run `npm run test:obsidian` before a release: CI has no Obsidian to run it in.

## Duet

Work happens on `preview`. `main` takes changes only through a pull request from `preview` whose checks pass (a ruleset on GitHub). `ci.yml` runs the type check, the lint, the unit tests, and the build on `preview` and on each pull request; `release.yml` tags and publishes `X.Y.Z` when `main` gets a version with no release. The steps are in Duet's README, under Development.

## Almagest

No further releases. The repository stays as a reference, with its workflows as they were. To remove it from the community directory, open a pull request to [obsidianmd/obsidian-releases](https://github.com/obsidianmd/obsidian-releases) that deletes its entry from `community-plugins.json`, or leave the entry: an archived plugin still installs, and its README says what replaced it.

## The community directory

A plugin in the directory needs a repository of its own, with `manifest.json` at the root and a release `X.Y.Z` whose assets are `main.js`, `manifest.json`, and `styles.css`. Duet has this, and so does Yami Wiki. To submit Yami Wiki, open a pull request to `obsidian-releases` that adds it to `community-plugins.json`: `{ "id": "yami-wiki", "name": "Yami Wiki", "author": "nathanaday", "description": …, "repo": "nathanaday/yami-wiki" }`. The review reads the whole repository, which is why the plugin's lint runs the same rules. Yami Threads stays out of the directory for now; the same steps submit it when it goes in.

## Into a vault

| How | For |
| --- | --- |
| **Settings → Community plugins → Browse** | Duet; Yami Wiki once it is in the directory. Updates come with Obsidian's **Check for updates**. |
| **[BRAT](https://github.com/TfTHacker/obsidian42-brat)** | Any plugin that has GitHub releases with the three assets, also before it is in the directory: add `nathanaday/yami-wiki` or `nathanaday/yami-threads`, and BRAT keeps it up to date. |
| **By hand** | Download the three assets of a release into `<vault>/.obsidian/plugins/<id>/`, and turn the plugin on. |
| **From a checkout** | `npm run install:vault -- /path/to/vault` in a plugin repository builds it and copies the three files into the vault. Or link the checkout into `.obsidian/plugins/<id>` once and run `npm run dev`; Duet does the same with `npm run plugin:dev` and its `dev-vault/`. Reload Obsidian, or turn the plugin off and on, to load a build. |
