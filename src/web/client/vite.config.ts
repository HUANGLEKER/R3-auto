import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const outputDirectory = path.resolve(__dirname, '../public');
// Never follow a redirected output directory when Vite removes the previous build.
if (fs.existsSync(outputDirectory) && fs.realpathSync(outputDirectory).toLowerCase() !== outputDirectory.toLowerCase()) {
    throw new Error('发布目录不能是指向其他目录的链接');
}

export default defineConfig({
    plugins: [
        react(),
        tailwindcss(),
    ],
    root: __dirname,
    base: './',
    build: {
        outDir: outputDirectory,
        emptyOutDir: true,
        manifest: true,
        sourcemap: false,
    },
});
