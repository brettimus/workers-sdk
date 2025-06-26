---
"@cloudflare/vite-plugin": minor
---

Add container support to the Vite plugin for development workflow

This change adds comprehensive container support to the Cloudflare Vite plugin, enabling developers to use Docker containers alongside Workers during development with `npm run dev`. The implementation provides feature parity with Wrangler's container functionality.

**Key features:**
- Automatic Docker container building during development
- Hot reload support for Dockerfile and container file changes
- Full integration with Miniflare and workerd
- Container binding to Durable Objects via `class_name` configuration
- Comprehensive error handling and logging

**Usage:**
Configure containers in `wrangler.json` exactly like with Wrangler:

```json
{
  "containers": [
    {
      "image": "./api/Dockerfile",
      "class_name": "ApiContainer",
      "instance_type": "dev"
    }
  ],
  "durable_objects": {
    "bindings": [
      {
        "class_name": "ApiContainer",
        "name": "API_CONTAINER"
      }
    ]
  }
}
```

Containers are accessed in Workers via the standard Durable Object container API (`ctx.container`).