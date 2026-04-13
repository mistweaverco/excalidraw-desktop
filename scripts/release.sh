#!/usr/bin/env bash

if [ -z "$VERSION" ]; then echo "Error: VERSION is not set"; exit 1; fi

BIN_NAME="Excalidraw Desktop"
GH_TAG="v$VERSION"
DIST_DIR="dist_sanitized"

FILES=()

LINUX_FILES=(
  "src-tauri/target/release/bundle/deb/${BIN_NAME}_${VERSION}_amd64.deb"
  "src-tauri/target/release/bundle/rpm/${BIN_NAME}-${VERSION}.x86_64.rpm"
  "src-tauri/target/release/bundle/appimage/${BIN_NAME}_${VERSION}_amd64.AppImage"
)

MACOS_FILES=(
  "src-tauri/target/release/bundle/macos/${BIN_NAME}.dmg"
)

WINDOWS_FILES=(
  "src-tauri/target/release/bundle/msi/${BIN_NAME}_${VERSION}_x64_en-US.msi"
  "src-tauri/target/release/bundle/nsis/${BIN_NAME}_${VERSION}_x64-setup.exe"
)

check_files_exist() {
  local missing_files=()
  for file in "${FILES[@]}"; do
    if [ ! -f "$file" ]; then
      missing_files+=("$file")
    fi
  done

  if [ ${#missing_files[@]} -gt 0 ]; then
    echo "Error: the following files do not exist:"
    for file in "${missing_files[@]}"; do
      printf " - %s\n" "$file"
    done
    exit 1
  fi
}

merge_all_platform_files() {
  FILES=("${LINUX_FILES[@]}" "${MACOS_FILES[@]}" "${WINDOWS_FILES[@]}")
}

prepare_sanitized_files() {
  echo "Sanitizing file names (removing version $VERSION, lowercasing, and replacing spaces)..."
  mkdir -p "$DIST_DIR"
  SANITIZED_FILES=()

  for file in "${FILES[@]}"; do
    filename=$(basename "$file")
    new_name=$(echo "$filename" | \
      sed "s/[-_.]\?${VERSION}//g" | \
      tr '[:upper:]' '[:lower:]' | \
      tr ' ' '-' | \
      sed 's/--\+/-/g')

    dest="$DIST_DIR/$new_name"
    cp "$file" "$dest"
    SANITIZED_FILES+=("$dest")
  done

  FILES=("${SANITIZED_FILES[@]}")
}

print_files() {
  echo "Files to upload:"
  for file in "${FILES[@]}"; do
    printf " - %s\n" "$file"
  done
}

do_gh_release() {
  echo "Creating new release $GH_TAG"
  print_files
  gh release create --generate-notes "$GH_TAG" "${FILES[@]}"
}

release() {
  merge_all_platform_files
  check_files_exist
  prepare_sanitized_files
  do_gh_release
}

release