/**
 * Minimal Cloudflare Plugin Entry Point
 * Test version to isolate import issues
 */

const plugin = {
  name: 'cloudflare',
  version: '1.0.0',
  description: 'Cloudflare integration (minimal test)',
  agents: [],
  commands: [
    {
      name: 'cloudflare.status',
      description: 'Show Cloudflare status',
      handler: 'status'
    }
  ],
  events: []
};

export default plugin;
