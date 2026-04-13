#!/usr/bin/env bash

if [ -z "$VERSION" ]; then echo "Error: VERSION is not set"; exit 1; fi

BIN_NAME="Excalidraw Desktop"
GH_TAG="v$VERSION"
FILES=()

LINUX_FILES=(
  "src-tauri/target/release/bundle/deb/${BIN_NAME}_${VERSION}_amd64.deb"
  "src-tauri/target/release/bundle/rpm/${BIN_NAME}-${VERSION}-x86_64.rpm"
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
  files=()
  for file in "${FILES[@]}"; do
    if [ ! -f "$file" ]; then
      files+=("$file")
    fi
  done
  if [ ${#files[@]} -gt 0 ]; then
    echo "Error: the following files do not exist:"
    for file in "${files[@]}"; do
      printf " - %s\n" "$file"
    done
    echo "This is the content of the dist directory:"
    ls -l dist/
    exit 1
  fi
}

merge_all_platform_files() {
  FILES=(
    "${LINUX_FILES[@]}"
    "${MACOS_FILES[@]}"
    "${WINDOWS_FILES[@]}"
  )
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
  set_release_action
  merge_all_platform_files
  check_files_exist
  do_gh_release
}

release
