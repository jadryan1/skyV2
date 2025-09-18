#!/bin/bash
# Enhanced production build script with proper ES2022 async/await support
echo "🔨 Starting production build with ES2022 target..."

# Build the frontend first
echo "📦 Building frontend..."
npm run vite:build 2>/dev/null || vite build

# Build the main server with proper ES2022 target for async/await support
echo "⚙️  Compiling server with ES2022 target..."
npx esbuild server/index.ts \
  --platform=node \
  --packages=external \
  --bundle \
  --format=esm \
  --target=es2022 \
  --outfile=dist/index.js \
  --sourcemap \
  --define:process.env.NODE_ENV="\"production\"" \
  --define:import.meta.env.DEV=false \
  --define:import.meta.env.PROD=true \
  --keep-names \
  --tree-shaking=true \
  --external:vite \
  --external:@vitejs/plugin-react \
  --external:@replit/vite-plugin-cartographer \
  --external:@replit/vite-plugin-runtime-error-modal

# Also build the standalone launcher for compatibility
echo "🚀 Building standalone launcher..."
npx esbuild server/mcp-standalone.ts \
  --platform=node \
  --packages=external \
  --bundle \
  --format=esm \
  --target=es2022 \
  --outfile=dist/mcp-standalone.js \
  --minify \
  --sourcemap

echo "✅ Production build complete!"
echo "📁 Build artifacts:"
ls -la dist/
echo ""
echo "🚀 Ready for deployment!"
echo "   Main server: node dist/index.js"
echo "   Standalone:  node dist/mcp-standalone.js"