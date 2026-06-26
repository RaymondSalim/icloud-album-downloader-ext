# Release checklist

This project is built for a **GitHub Release → store upload** workflow. You do not need to run `./build.sh` locally before publishing.

## How it works

```
Bump version in manifests → commit → git tag vX.Y.Z → git push origin vX.Y.Z
                                                              ↓
                                              GitHub Actions (Pack Extensions)
                                                              ↓
                         Build artifacts + AMO listed submit + self-signed XPI
                                                              ↓
                                    GitHub Release with .zip + .xpi attached
                                                              ↓
                              Upload Chrome .zip manually; Firefox listed is auto-submitted
```

CI runs `./build.sh --prod` using repository secrets. Your local `config.js` is never used.

## Before you tag

1. Bump `version` in `manifest.json` and `manifest_firefox.json` (must match the tag, e.g. `1.1.0` → `v1.1.0`).
2. Update `PRIVACY.md` date if the policy changed.
3. Confirm these GitHub repository secrets are set (Settings → Secrets → Actions):
   - `REPORT_ENDPOINT` — Cloudflare Worker URL (e.g. `https://….workers.dev/report`)
   - `REPORT_SECRET` — shared bearer token for the worker
   - `AMO_API_KEY` + `AMO_API_SECRET` — AMO listed submit + self-distribution signing
   - Optional: `CRX_PRIVATE_KEY` — produces a `.crx` in the release (Chrome Web Store uses the `.zip`)

4. Commit and push to `main`.

## Create the release

```bash
git tag v1.1.0
git push origin v1.1.0
```

Wait for the **Pack Extensions** workflow to finish. On tag pushes it will:

- Build production packages with reporting config injected from secrets
- Submit `1.1.0` to AMO **listed** for review (if AMO secrets are set)
- Sign a **self-distribution** XPI as `1.1.0-self` (unlisted, avoids AMO version conflicts)
- Attach artifacts to a new GitHub Release

## Upload to the stores

Download Chrome artifacts from the [GitHub Releases](https://github.com/RaymondSalim/icloud-album-downloader-ext/releases) page.

**Chrome Web Store**

- File: `icloud-album-downloader-chrome-<version>.zip`
- Upload at [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole)
- Privacy policy URL: link to `PRIVACY.md` on GitHub

**Firefox Add-ons (AMO)**

- **Listed (public store):** submitted automatically by CI on tag push. Check status at [addons.mozilla.org/developers](https://addons.mozilla.org/developers/).
- **Self-distribution (optional):** `icloud-album-downloader-firefox-<version>-self-signed.xpi` from the GitHub Release. Manifest version inside is `<version>-self` (e.g. `1.1.0-self`).
- Extension ID: `icloud-album-downloader-pub@extension` (fixed in `manifest_firefox.json`)

AMO does not allow the same version number on listed and unlisted channels. That is why the store build uses `1.1.0` and the self-host build uses `1.1.0-self`.

## Verify the release artifact (optional)

Download the listed `.xpi` from the GitHub Release, then:

```bash
unzip -p icloud-album-downloader-firefox-1.1.0.xpi config.js
unzip -p icloud-album-downloader-firefox-1.1.0.xpi manifest.json | jq .host_permissions
```

Reporting should show `enabled: true` with your worker URL, and host permissions should include your specific worker origin (not `*.workers.dev`).

After installing from the store build, test reporting:

```js
chrome.runtime.sendMessage({ type: "test-report" }).then(console.log)
```

## Local prod build (debugging only)

Only needed if you want to inspect a package without tagging:

```bash
REPORT_ENDPOINT="https://..." REPORT_SECRET="..." ./build.sh --prod
```

Do not upload local builds to the stores if you already use GitHub Releases.
