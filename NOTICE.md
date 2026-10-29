# Vulcan Office — Provenance and License Notice

This directory contains **modified source code derived from third-party
projects**, vendored as full source snapshots ("Vulcan Office"):

- `online/` — derived from Collabora Online
  ([CollaboraOnline/online.mirror](https://github.com/CollaboraOnline/online.mirror),
  the official read-only mirror of the source developed at
  `gerrit.collaboraoffice.com`), branch `main`.
- `libreoffice-core/` — derived from LibreOffice core
  ([LibreOffice/core](https://github.com/LibreOffice/core) mirror of
  `git.libreoffice.org/core`), branch `distro/collabora/co-26.04`.

The exact upstream commit each snapshot was taken from — along with the import
date and the sha256 of the imported source tarball — is recorded per tree in
[`UPSTREAM.json`](./UPSTREAM.json) in this directory.

## License

Both upstream projects are licensed under the
**Mozilla Public License, v. 2.0 (MPL-2.0)** (<https://mozilla.org/MPL/2.0/>).
Portions of LibreOffice core are additionally available under other licenses as
described by its in-tree license documentation.

- All upstream `LICENSE`, `COPYING`, `COPYING.MPL`, and
  `THIRDPARTYLICENSEREADME`-style license files are **retained in-tree,
  unmodified**, inside each vendored snapshot. Nothing in the import process
  removes or rewrites license files.
- **Modifications** made by Vulcan to these snapshots are recorded in this
  repository's git history: every change to files under `vendor/vulcan-office/`
  after an import commit is a Vulcan modification, diffable against the
  snapshot recorded in `UPSTREAM.json` (see
  `docs/runbooks/vulcan-office-import-runbook.md` for the exact procedure).
  Per MPL-2.0 §3.1–3.2, the source code form of these files, including our
  modifications, remains governed by the MPL.
- The **built browser bundle** distributed to end users (the webpack output
  served by the Vulcan Office/coolwsd container) retains the upstream license
  notices it embeds, satisfying MPL-2.0 §3.2 (distribution of executable form):
  the source code form is available under the MPL in this vendored tree, and
  notices within the source files are not removed by our build.

This notice is informational and does not itself grant or modify any license.
The authoritative license texts are the ones shipped inside each vendored
snapshot.
