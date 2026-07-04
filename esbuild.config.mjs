import esbuild from 'esbuild';
import babel from 'esbuild-plugin-babel';
import { readFileSync } from 'node:fs';

await esbuild.build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  outfile: 'dist/comix-downloader.min.user.js',
  platform: 'browser',
  format: 'iife',
  target: ['es2022'],
  external: ['jszip'],
  banner: {
    js: readFileSync('tampermonkey-header.txt', { encoding: 'utf8' })
  },
  plugins: [
    babel({
      filter: /\.[j]sx?$/,
      namespace: ''
    })
  ]
})