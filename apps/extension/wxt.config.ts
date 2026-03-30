import path from 'node:path';

import { defineConfig } from 'wxt';

export default defineConfig({
  dev: {
    server: {
      port: 3001
    }
  },
  manifest: {
    name: 'Riva',
    description: 'A page-aware browser copilot with chat and tab intelligence.',
    action: {
      default_title: 'Open Riva'
    },
    commands: {
      'toggle-riv-sidepanel': {
        suggested_key: {
          default: 'Ctrl+Shift+Y',
          mac: 'Command+J'
        },
        description: 'Open or close the Riva side panel'
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
