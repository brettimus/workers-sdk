---
"@cloudflare/vite-plugin": minor
---

Add support for running Containers locally with the Cloudflare Vite plugin, in order to have feature parity with `wrangler dev`.

- Automatically build Docker containers during local development
- Hot reload support for Dockerfile and container file changes
- Integration with Miniflare and workerd
- Container binding to Durable Objects via `class_name` configuration in `wrangler.json`
