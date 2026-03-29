import path from 'node:path';

import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: {
    name: 'Riv',
    description: 'A page-aware browser copilot with chat and tab intelligence.',
    action: {
      default_title: 'Open Riv'
    },
    commands: {
      'toggle-riv-sidepanel': {
        suggested_key: {
          default: 'Ctrl+Shift+Y',
          mac: 'Command+J'
        },
        description: 'Open or close the Riv side panel'
      }
    },
    permissions: [
      'activeTab',
      'storage',
      'tabs',
      'tabGroups',
      'scripting',
      'sidePanel'
    ]
  },
  vite: () => ({
    resolve: {
      alias: {
        '@riv/contracts': path.resolve(
          __dirname,
          '../../packages/contracts/src/index.ts'
        )
      }
    }
  }),
  modules: ['@wxt-dev/module-react']
});
