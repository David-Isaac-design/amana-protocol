#!/usr/bin/env bash
set -euo pipefail

if ! command -v rustup >/dev/null 2>&1; then
  echo "rustup is required; install the Rust devcontainer feature first." >&2
  exit 1
fi

rustup toolchain install stable --profile minimal --component clippy,rustfmt --target wasm32-unknown-unknown
rustup default stable
mkdir -p "$HOME/.cargo/bin"

if ! command -v stellar >/dev/null 2>&1; then
  version=30.0.1
  case "$(uname -m)" in
    x86_64)
      archive="stellar-cli-${version}-x86_64-unknown-linux-gnu.tar.gz"
      checksum="48c70074020e09af0a3ebbd2bf62d53c9aec47935e49a112d3cd90fb4e37658f"
      ;;
    aarch64)
      archive="stellar-cli-${version}-aarch64-unknown-linux-gnu.tar.gz"
      checksum="145785bb4bfd9711a7af1b4cf13a38ae31034421401a5fed061be35baf01373a"
      ;;
    *)
      echo "No pinned Stellar CLI binary is available for $(uname -m)." >&2
      exit 1
      ;;
  esac

  download="/tmp/${archive}"
  curl --fail --location --silent --show-error \
    "https://github.com/stellar/stellar-cli/releases/download/v${version}/${archive}" \
    --output "$download"
  echo "${checksum}  ${download}" | sha256sum --check
  tar -xzf "$download" -C "$HOME/.cargo/bin"
  rm -f "$download"
fi

if ! command -v cargo-audit >/dev/null 2>&1; then
  cargo install --locked cargo-audit
fi
