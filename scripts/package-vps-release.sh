#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
head_sha="$(git -C "$repo_root" rev-parse HEAD)"
output_path="${1:-/private/tmp/mise-vps-${head_sha}.tar.gz}"
output_dir="$(dirname "$output_path")"

if ! git -C "$repo_root" diff --quiet || ! git -C "$repo_root" diff --cached --quiet; then
  echo "Tracked changes are present; commit and validate the exact release state first." >&2
  exit 1
fi

if [[ ! -d "$repo_root/dist" ]]; then
  echo "dist/ is missing; build and validate the release before packaging." >&2
  exit 1
fi

if [[ ! -d "$output_dir" ]]; then
  echo "Output directory does not exist: $output_dir" >&2
  exit 1
fi

stage_root="$(mktemp -d "${TMPDIR:-/private/tmp}/mise-vps-package.XXXXXX")"
archive_tmp="${output_path}.tmp.$$"
chmod 755 "$stage_root"

cleanup() {
  rm -rf -- "$stage_root"
  rm -f -- "$archive_tmp"
}
trap cleanup EXIT

git -C "$repo_root" archive "$head_sha" | tar -xf - -C "$stage_root"

# COPYFILE_DISABLE prevents macOS tar from creating AppleDouble `._*` files.
# The explicit excludes and checks make the package fail closed if metadata
# appears through another copy path.
COPYFILE_DISABLE=1 tar \
  --no-xattrs \
  --exclude='._*' \
  --exclude='.DS_Store' \
  --exclude='dist/server/.wrangler' \
  --exclude='dist/server/.wrangler/*' \
  -cf - \
  -C "$repo_root" dist | tar -xf - -C "$stage_root"

if find "$stage_root" -type f \( -name '._*' -o -name '.DS_Store' \) -print -quit | grep -q .; then
  echo "Refusing to package macOS metadata files." >&2
  exit 1
fi

COPYFILE_DISABLE=1 tar \
  --no-xattrs \
  --exclude='._*' \
  --exclude='.DS_Store' \
  -czf "$archive_tmp" \
  -C "$stage_root" .

if tar -tzf "$archive_tmp" | awk -F/ '$NF ~ /^\._/ || $NF == ".DS_Store" { found=1 } END { exit found ? 0 : 1 }'; then
  echo "Refusing to publish an archive containing macOS metadata files." >&2
  exit 1
fi

mv -f -- "$archive_tmp" "$output_path"
trap - EXIT
rm -rf -- "$stage_root"

echo "VPS archive: $output_path"
echo "HEAD: $head_sha"
shasum -a 256 "$output_path"
