# Changelog

## [0.3.0](https://github.com/fabieu/parquet-viewer/compare/v0.2.0...v0.3.0) (2026-10-15)


### Features

* export the current view to Parquet or CSV ([850302e](https://github.com/fabieu/parquet-viewer/commit/850302ea75225ff543866ed8f08109406255c03e))


### Performance Improvements

* fetch only the visible columns and batch neighbouring pages ([301b6a5](https://github.com/fabieu/parquet-viewer/commit/301b6a597ae47c3df15adb80a02c4b0b0c22b634))
* store only row numbers for filtered and large sorted views ([b4553a0](https://github.com/fabieu/parquet-viewer/commit/b4553a0827ff43840a233ce07d41a95c8ac28c8e))

## [0.2.0](https://github.com/fabieu/parquet-viewer/compare/v0.1.0...v0.2.0) (2026-10-14)


### Features

* add column selection, resizable sidebar and grid navigation ([a713fd8](https://github.com/fabieu/parquet-viewer/commit/a713fd8c5915841fe7acadb56f4afa42c4435812))
* implement read-only Parquet viewer ([6ead83a](https://github.com/fabieu/parquet-viewer/commit/6ead83ad93af2630f752ea3a4f76d97d1006fb08))
* list every bundled third-party license in the About dialog ([eaacc54](https://github.com/fabieu/parquet-viewer/commit/eaacc54ab869390dd2fba021236aa23bb50c50bc))
* redesign the UI with a dark, high-contrast theme ([e334fdf](https://github.com/fabieu/parquet-viewer/commit/e334fdfa1f2b67f88164d3eb5f863856dbde9b0e))
* replace default Tauri icon with a Parquet viewer app icon ([bacfda0](https://github.com/fabieu/parquet-viewer/commit/bacfda0bc7dee8a3432497e1a34b318920f91e39))
* show the compression codec in the status bar ([18f3e94](https://github.com/fabieu/parquet-viewer/commit/18f3e9430d92bd95fd32043031b8d8fba95f1dd1))


### Bug Fixes

* collapse nested if in macOS file-open handler ([1599ae2](https://github.com/fabieu/parquet-viewer/commit/1599ae288fa21ced7732abdedfe78e8855a4ee59))
