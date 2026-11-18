import { resolveElectronMirror } from './build/electron-mirror.js'
import { asarUnpack as nativeModuleAsarUnpack, files as nativeModuleFiles } from './build/native-modules.js'
import { appx, nsis, portable, win } from './build/platform-win.js'
import { mac } from './build/platform-mac.js'
import { deb, flatpak, linux, rpm } from './build/platform-linux.js'

/** @type {import('electron-builder').Configuration} */
export default {
  productName: 'Escrcpy',
  appId: 'org.viarotel.escrcpy',

  directories: {
    output: 'dist-release',
    buildResources: 'electron/resources/build',
  },

  files: nativeModuleFiles,

  asar: true,

  asarUnpack: nativeModuleAsarUnpack,

  // NOTE: the madb MCP server package lives in the private upstream repo;
  // nothing in this tree references it, so no extraResources entry is needed.

  win,
  nsis,
  portable,
  appx,

  mac,

  linux,
  flatpak,
  deb,
  rpm,

  npmRebuild: true,

  publish: {
    provider: 'github',
    owner: 'cshdotcom',
    repo: 'escrcpy',
    updaterCacheDirName: 'escrcpy-updater',
  },

  electronDownload: {
    mirror: resolveElectronMirror(),
  },
}
