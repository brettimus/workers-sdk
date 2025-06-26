# Container Test Fixture

This test fixture demonstrates container support in the Cloudflare Vite Plugin.

## Setup

1. Make sure Docker is installed and running
2. Run `pnpm dev` to start the development server

## What it does

- Defines a Cloudflare Worker with a Durable Object (`ApiContainer`)
- The Durable Object is connected to a Docker container via the `containers` configuration
- The container runs a simple Express.js API server
- When you visit `/api`, the Worker forwards requests to the container

## Testing

1. Visit `http://localhost:5173/` - Should show a welcome message
2. Visit `http://localhost:5173/api` - Should proxy to the container and return JSON
3. Visit `http://localhost:5173/api/health` - Should return container health info

## Hot Reload

Try editing `api/server.js` or the `Dockerfile` - the container should automatically rebuild and restart.

## Configuration

The container is configured in `wrangler.jsonc`:

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

This links the `ApiContainer` Durable Object class to the Docker container built from `./api/Dockerfile`.