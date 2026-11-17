import { describe, it, expect } from 'vitest'
import manifest from '../../../../linea/node_modules/material-icon-theme/dist/material-icons.json'
import { fileIcon, folderIcon } from '../../client/fileIconNames.js'

describe('the icon of a file or a folder', () => {
  it('knows files by their name, then by their longest extension', () => {
    expect(fileIcon(manifest, 'package.json')).toBe('nodejs')
    expect(fileIcon(manifest, 'App.vue')).toBe('vue')
    expect(fileIcon(manifest, 'data.JSON')).toBe('json')
    expect(fileIcon(manifest, 'Main.java')).toBe('java')
  })
  it('gives a template the icon of what it makes', () => {
    expect(fileIcon(manifest, '_package.json')).toBe(fileIcon(manifest, 'package.json'))
    expect(fileIcon(manifest, '_entity.java')).toBe('java')
  })
  it('knows the files of this editor', () => {
    expect(fileIcon(manifest, 'featuremodel.featuremodel')).toBe('tree')
  })
  it('falls back to a plain file', () => {
    expect(fileIcon(manifest, 'whatever.unknownext')).toBe('file')
  })
  it('knows the folders, open or closed', () => {
    expect(folderIcon(manifest, 'src')).toBe('folder-src')
    expect(folderIcon(manifest, 'src', true)).toBe('folder-src-open')
    expect(folderIcon(manifest, 'zzz')).toBe('folder')
    expect(folderIcon(manifest, 'zzz', true)).toBe('folder-open')
  })
})
