#!/usr/bin/env bash
set -e

echo "Building install-notifications artifacts..."

mkdir -p dist
rm -rf dist/*

temp_dir=$(mktemp -d)

echo " • Building macOS arm64 (Apple Silicon)..."
GOOS=darwin GOARCH=arm64 go build -o "$temp_dir/install-notifications-darwin-arm64" main.go

echo " • Building macOS amd64 (Intel)..."
GOOS=darwin GOARCH=amd64 go build -o "$temp_dir/install-notifications-darwin-amd64" main.go

echo " • Creating macOS universal binary..."
lipo -create -output dist/install-notifications "$temp_dir/install-notifications-darwin-arm64" "$temp_dir/install-notifications-darwin-amd64"
rm -rf "$temp_dir"

echo " • Building Windows amd64..."
GOOS=windows GOARCH=amd64 go build -o dist/install-notifications-windows-amd64.exe main.go

echo " • Building Windows arm64..."
GOOS=windows GOARCH=arm64 go build -o dist/install-notifications-windows-arm64.exe main.go

echo " • Building Linux amd64..."
GOOS=linux GOARCH=amd64 go build -o dist/install-notifications-linux-amd64 main.go

echo " • Building Linux arm64..."
GOOS=linux GOARCH=arm64 go build -o dist/install-notifications-linux-arm64 main.go

echo "Build complete. Artifacts are available in ./dist"
