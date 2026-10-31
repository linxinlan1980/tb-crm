// Local read-only example. Uses the installed official MCP SDK, never prints tokens.
import { createRequire } from 'node:module';
const require = createRequire(new URL('../apps/api/package.json', import.meta.url));
const { Client } = await import(require.resolve('@modelcontextprotocol/sdk/client/index.js'));
const { StreamableHTTPClientTransport } = await import(require.resolve('@modelcontextprotocol/sdk/client/streamableHttp.js'));
const base = new URL(process.env.CRM_URL || 'http://localhost:3000');
if (!['localhost', '127.0.0.1'].includes(base.hostname)) throw new Error('This demo example only connects to a local CRM');
const password = process.env.CRM_PASSWORD || process.env.SEED_ADMIN_PASSWORD;
if (!password) throw new Error('Set CRM_PASSWORD or SEED_ADMIN_PASSWORD');
const response = await fetch(new URL('/api/v1/auth/login', base), {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: process.env.CRM_USERNAME || 'sales', password }),
});
if (!response.ok) throw new Error('CRM login failed');
const token = (await response.json()).data.accessToken;
const client = new Client({ name: 'tb-crm-local-read-demo', version: '1.0.0' });
try {
  await client.connect(new StreamableHTTPClientTransport(new URL('/api/v1/mcp', base), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  }));
  console.log('Tools:', (await client.listTools()).tools.map((tool) => tool.name).join(', '));
  console.log('Resources:', (await client.listResources()).resources.map((resource) => resource.uri).join(', '));
  const result = await client.callTool({ name: 'customer.search', arguments: { keyword: process.env.CRM_KEYWORD || '星河', pageSize: 5 } });
  if (result.isError) throw new Error(JSON.stringify(result));
  console.log(JSON.stringify(result, null, 2));
} finally {
  await client.close();
}
