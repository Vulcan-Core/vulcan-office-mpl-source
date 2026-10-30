# Vulcan Office: MPL-2.0 source for modified Collabora Online files

This repository contains the source code form of files from
[Collabora Online](https://github.com/CollaboraOnline/online.mirror) (including the
LibreOffice core tree it vendors at `online/engine/`) that Vulcan Technologies, Inc.
has modified for "Vulcan Office". These files are Covered Software under the
[Mozilla Public License, v. 2.0](LICENSE-MPL-2.0.txt) and remain under that license.

## Layout

- **Commit 1** holds the upstream versions of every affected file, exactly as imported from
  `CollaboraOnline/online.mirror` at commit `3e71f749c955014d13e4db055a65ea50c18d64d7`
  (see `UPSTREAM.json`).
- **Commit 2** applies Vulcan's modifications. `git diff HEAD~1 HEAD` shows every change.

| Change | Files |
|---|---|
| Modified | 960 |
| Renamed (`com.collaboraoffice.demo-*` to `ai.vulcan.office.demo-*`) | 6 |
| Removed | 18 |

Paths mirror the upstream repository layout. Files Vulcan did not modify are unchanged from
upstream and are available from the upstream repository at the commit above.

Snapshot date: 2026-10-30.

## Notices

`NOTICE.md` is Vulcan's provenance and license notice for the vendored tree. Upstream license
files (`online/COPYING` and others) are retained unmodified.

Some code comments, log-message text and repository URLs were edited to remove references to internal systems and people. Program behavior is unchanged.
