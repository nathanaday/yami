# Checks and releases

How each repository of the Yami ecosystem is checked and released, and how a plugin gets into a vault. One rule for all of them: **a version bump on `main` is a release.** CI checks every change; the release workflow publishes a version the first time `main` holds it, and does nothing otherwise.

| Repository | What it holds | Where it is published |
| --- | --- | --- |
| [`yami`](https://github.com/nathanaday/yami) | The library (`yami/`), and for now the two plugins (`plugins/yami-wiki/`, `plugins/yami-threads/`) | GitHub releases: `yami-X.Y.Z` (a `.tgz`), `yami-wiki-X.Y.Z`, `yami-threads-X.Y.Z` |
| [`obsidian-duet`](https://github.com/nathanaday/obsidian-duet) | Duet, the conversation plugin | The community directory, from GitHub releases `X.Y.Z` |
| [`obsidian-almagest`](https://github.com/nathanaday/obsidian-almagest) | Almagest, at its end of life | The community directory; no further releases |

## The yami repository

`.github/workflows/ci.yml` runs on every push to `main` and every pull request: the library's build and unit tests, then for each plugin, against the library at that commit, the type check, Obsidian's lint, the unit tests, and the build.

`.github/workflows/release.yml` runs on every push to `main`, one job for each of the three:

| Job | Reads the version from | Skips when the release exists | Publishes |
| --- | --- | --- | --- |
| library | `yami/package.json` | `yami-X.Y.Z` | `yami-X.Y.Z.tgz`, from `npm pack` |
| yami-wiki | `plugins/yami-wiki/manifest.json` | `yami-wiki-X.Y.Z` | `main.js`, `manifest.json`, `styles.css` |
| yami-threads | `plugins/yami-threads/manifest.json` | `yami-threads-X.Y.Z` | `main.js`, `manifest.json`, `styles.css` |

To release the library:

```sh
cd yami
npm version X.Y.Z --no-git-tag-version   # package.json and package-lock.json
# set VERSION in src/version.ts to the same, and add the entry to CHANGELOG.md
git commit -am "yami X.Y.Z" && git push
```

To release a plugin:

```sh
cd plugins/yami-wiki
npm run set-version X.Y.Z                # manifest.json, package.json, package-lock.json, versions.json
git commit -am "yami-wiki X.Y.Z" && git push
```

A unit test in each plugin holds its four version files to one version. Run `npm run test:obsidian` in the plugin before a release: CI has no Obsidian to run it in.

The plugins take the library from the working tree, `"yami": "file:../../yami"`, so a change to the library and a plugin ships in one commit, and CI tests the two together. A plugin outside this repository (Duet) takes a release instead: `"yami": "https://github.com/nathanaday/yami/releases/download/yami-X.Y.Z/yami-X.Y.Z.tgz"`. Its lockfile pins the URL and no integrity hash, since the hash is known only once the release exists; `npm install yami@<url>` after the release adds one.

## Duet

Work happens on `preview`. `main` takes changes only through a pull request from `preview` whose checks pass (a ruleset on GitHub). `.github/workflows/ci.yml` runs the type check, the lint, the unit tests, and the build on `preview` and on each pull request; `.github/workflows/release.yml` tags and publishes `X.Y.Z` when `main` gets a version with no release. The steps are in Duet's README, under Development.

A Duet release that takes a new library needs the library released first: the `yami-X.Y.Z` release must exist before Duet's `npm ci` can fetch it.

## Almagest

No further releases. The repository stays as a reference, with its workflows as they were. To remove it from the community directory, open a pull request to [obsidianmd/obsidian-releases](https://github.com/obsidianmd/obsidian-releases) that deletes its entry from `community-plugins.json`, or leave the entry: an archived plugin still installs, and its README says what replaced it.

## The community directory

A plugin in the directory needs a repository of its own, with `manifest.json` at the root and a release `X.Y.Z` whose assets are `main.js`, `manifest.json`, and `styles.css`. Duet has this. Yami Wiki is built as a repository root inside `plugins/yami-wiki/` (its own README, LICENSE, `.github/workflows/`, lint, and tests), so moving it out is one step:

```sh
# In the yami repository, on main:
git subtree split --prefix=plugins/yami-wiki -b yami-wiki-split
# Create the empty repository github.com/nathanaday/yami-wiki, then:
git push git@github.com:nathanaday/yami-wiki.git yami-wiki-split:main
```

Then in the new repository, change `package.json` to take the library from a release (`"yami": "https://github.com/nathanaday/yami/releases/download/yami-X.Y.Z/yami-X.Y.Z.tgz"`), run `npm install`, and push. Its `.github/workflows/` run from then on and publish `X.Y.Z` releases with the three assets. Remove `plugins/yami-wiki/` from the yami repository and its two release jobs. Submit the plugin with a pull request to `obsidian-releases` that adds it to `community-plugins.json`: `{ "id": "yami-wiki", "name": "Yami Wiki", "author": "nathanaday", "description": …, "repo": "nathanaday/yami-wiki" }`. The review reads the whole repository, which is why the plugin's lint runs the same rules.

Yami Threads stays out of the directory for now. The same steps move it out when it goes in.

## Into a vault

| How | For |
| --- | --- |
| **Settings → Community plugins → Browse** | Duet; Yami Wiki once it is in the directory. Updates come with Obsidian's **Check for updates**. |
| **[BRAT](https://github.com/TfTHacker/obsidian42-brat)** | Any plugin that has GitHub releases with the three assets, also before it is in the directory. For a plugin in the yami repository, add the repository with a frozen version, `yami-wiki-X.Y.Z`, since the repository's latest release can be the library's. |
| **By hand** | Download the three assets of a release into `<vault>/.obsidian/plugins/<id>/`, and turn the plugin on. |
| **From a checkout** | `npm run install:vault -- /path/to/vault` in a plugin folder builds it and copies the three files into the vault. Or link the folder into `.obsidian/plugins/<id>` once and run `npm run dev`; Duet does the same with `npm run plugin:dev` and its `dev-vault/`. Reload Obsidian, or turn the plugin off and on, to load a build. |
