# CAD Viewer Example

This is an example application that demonstrates how to use the `@mlightcad/cad-viewer` component with a full-featured Vue.js interface.

[**🌐 Live Demo**](https://mlightcad.github.io/cad-viewer-example/)

## Features

- 🎨 **Full UI Interface**: Complete CAD viewer with toolbars, menus, and status bar
- 🌐 **Internationalization**: Multi-language support (English and Chinese)
- 🎯 **Advanced Controls**: Layer management, point styles, settings, and more
- 📁 **File Support**: DXF and DWG file loading with drag & drop

## Development

```bash
# Install dependencies
pnpm install
pnpm config set store-dir D:\.pnpm-store
Remove-Item -Recurse -Force node_modules
pnpm install --frozen-lockfile

pnpm add proj4

# Start development server
pnpm dev

# Build for production
pnpm build

# Preview production build
pnpm preview
```

### Optional runtime flags

- `VITE_FORCE_MAIN_THREAD_DRAW=true` forces the viewer to use the CPU fallback path.
- `VITE_ENABLE_OSM_OVERLAY=false` disables the OSM overlay during CAD viewing.
- `VITE_LARGE_FILE_MODE_THRESHOLD_MB=150` adjusts when the app enables large-file fast path.
- `VITE_LARGE_FILE_MINIMUM_CHUNK_SIZE=12000` entity conversion chunk size for large files.
- `VITE_LARGE_FILE_RENDER_CHUNK_SIZE=800` Three.js convert yield size for large files.
- `VITE_PARSER_TIMEOUT_MAX_MS=600000` max parser worker timeout for big DWG/DXF files.

## Usage

Firstly, add the following dependencies into your package.json.

- @mlightcad/cad-simple-viewer
- @mlightcad/cad-viewer
- @mlightcad/data-model
- element-plus
- vue
- vue-i18n

Secondly, add the following code in your Vue component.


```vue
<template>
  <MlCadViewer locale="zh" url="https://cdn.jsdelivr.net/gh/mlightcad/cad-data/data/anteen.dwg" />
</template>

<script setup lang="ts">
import { MlCadViewer } from '@mlightcad/cad-viewer'
</script>
```

Finally, copy the following files to **dist/assets** folder.

- ./node_modules/@mlightcad/data-model/dist/dxf-parser-worker.js
- ./node_modules/@mlightcad/cad-simple-viewer/dist/libredwg-parser-worker.js
- ./node_modules/@mlightcad/cad-simple-viewer/dist/mtext-renderer-worker.js

Those files are used to parser dxf/dwg files in web worker so that UI not blocked. You can copy those files to folder **dist/assets** manually.
However, vite-plugin-static-copy is recommended to make your life easier.

```typescript
import { defineConfig } from 'vite'
import { viteStaticCopy } from 'vite-plugin-static-copy'
import vue from '@vitejs/plugin-vue'

export default defineConfig(() => {
  const plugins = [
    vue(),
    viteStaticCopy({
      targets: [
        {
          src: './node_modules/@mlightcad/data-model/dist/dxf-parser-worker.js',
          dest: 'assets'
        },
        {
          src: './node_modules/@mlightcad/cad-simple-viewer/dist/*-worker.js',
          dest: 'assets'
        }
      ]
    })
  ]

  return {
    base: './',
    build: {
      outDir: 'dist',
      modulePreload: false,
      rollupOptions: {
        // Main entry point for the app
        input: {
          main: 'index.html'
        }
      }
    },
    plugins: plugins
  }
})
```

## License

[MIT](LICENSE)