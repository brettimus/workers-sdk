import { DurableObject } from "cloudflare:workers";

export { ApiContainer };

interface Env {
	API_CONTAINER: DurableObjectNamespace<ApiContainer>;
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);

		if (url.pathname === "/") {
			return new Response(
				"Container Worker is running! Try /api to test the container."
			);
		}

		if (url.pathname === "/api") {
			// Get a Durable Object instance
			const id = env.API_CONTAINER.idFromName("api");
			const stub = env.API_CONTAINER.get(id);

			// Forward the request to the Durable Object
			return stub.fetch(request);
		}

		return new Response("Not found", { status: 404 });
	},
};

class ApiContainer extends DurableObject<Env> {
	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
	}

	async fetch(request: Request): Promise<Response> {
		// This Durable Object can control and communicate with its container
		const container = this.ctx.container;

		if (!container) {
			return new Response("Container not available", { status: 503 });
		}

		try {
			// Start the container if not running
			if (!container.running) {
				await container.start({
					entrypoint: ["node", "server.js"],
					env: {
						PORT: "8080",
						NODE_ENV: "development",
					},
				});
			}

			// Get the container's port and forward the request
			const port = container.getTcpPort(8080);
			const containerResponse = await port.fetch(
				"http://localhost" + new URL(request.url).pathname
			);

			return new Response(containerResponse.body, {
				status: containerResponse.status,
				statusText: containerResponse.statusText,
				headers: containerResponse.headers,
			});
		} catch (error) {
			console.error("Container error:", error);
			return new Response("Container error: " + (error as Error).message, {
				status: 500,
			});
		}
	}
}
