#!/usr/bin/env bash
set -e

echo "Building Go installer for macOS..."

mkdir -p dist

echo " • Building arm64 (Apple Silicon)..."
GOOS=darwin GOARCH=arm64 go build -o dist/installer-arm64 main.go

echo " • Building amd64 (Intel)..."
GOOS=darwin GOARCH=amd64 go build -o dist/installer-amd64 main.go

echo " • Creating Universal Binary..."
lipo -create -output install-notifications dist/installer-arm64 dist/installer-amd64

rm -rf dist

echo "✅ Universal binary created: ./install-notifications"
