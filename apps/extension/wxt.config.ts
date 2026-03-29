import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: {
    name: 'Riv',
    description: 'A page-aware browser copilot with chat and tab intelligence.',
    permissions: ['activeTab', 'storage', 'tabs', 'tabGroups', 'scripting', 'sidePanel']
  },
  modules: ['@wxt-dev/module-react']
});
