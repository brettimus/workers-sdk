import { describe, test } from "vitest";
import { fetchJson, runLongLived, seed, waitForReady } from "./helpers.js";

const packageManagers = ["pnpm"] as const;
const commands = ["dev"] as const;

describe("containers e2e tests", () => {
	describe.each(packageManagers)('with "%s" package manager', async (pm) => {
		const projectPath = seed("containers", pm);

		describe.each(commands)('with "%s" command', (command) => {
			// Skip container tests in CI unless Docker is explicitly available
			test.skipIf(!process.env.DOCKER_AVAILABLE && process.env.CI)(
				"can serve worker welcome page",
				async ({ expect }) => {
					const proc = await runLongLived(pm, command, projectPath);
					const url = await waitForReady(proc);

					const response = await fetch(url);
					const text = await response.text();

					expect(text).toContain("Container Worker is running!");
					expect(text).toContain("Try /api to test the container");
				}
			);

			test.skipIf(!process.env.DOCKER_AVAILABLE && process.env.CI)(
				"should handle container configuration",
				async ({ expect }) => {
					const proc = await runLongLived(pm, command, projectPath);
					const url = await waitForReady(proc);

					// Test that the worker is properly configured
					const response = await fetch(url);
					expect(response.status).toBe(200);

					// Test 404 handling
					const notFoundResponse = await fetch(url + "/nonexistent");
					expect(notFoundResponse.status).toBe(404);
				}
			);

			test.skipIf(!process.env.DOCKER_AVAILABLE)(
				"can communicate with container via Durable Object",
				async ({ expect }) => {
					const proc = await runLongLived(pm, command, projectPath, {
						// Increase timeout for container builds
						timeout: 120000, // 2 minutes for Docker builds
					});
					const url = await waitForReady(proc);

					// Test container API endpoint
					const apiResponse = await fetchJson(url + "/api/");
					expect(apiResponse).toEqual({
						message: "Hello from the container!",
						timestamp: expect.any(String),
						environment: "development",
					});

					// Test container health endpoint
					const healthResponse = await fetchJson(url + "/api/health");
					expect(healthResponse).toEqual({
						status: "healthy",
						uptime: expect.any(Number),
						memory: expect.any(Object),
					});
				}
			);

			test.skipIf(!process.env.DOCKER_AVAILABLE)(
				"can handle POST requests to container",
				async ({ expect }) => {
					const proc = await runLongLived(pm, command, projectPath, {
						timeout: 120000,
					});
					const url = await waitForReady(proc);

					const testData = { message: "test from e2e" };
					const response = await fetch(url + "/api/echo", {
						method: "POST",
						headers: {
							"Content-Type": "application/json",
						},
						body: JSON.stringify(testData),
					});

					const result = await response.json();
					expect(result).toEqual({
						received: testData,
						headers: expect.any(Object),
						method: "POST",
					});
				}
			);

			test.skipIf(!process.env.DOCKER_AVAILABLE)(
				"should handle container startup time",
				async ({ expect }) => {
					const proc = await runLongLived(pm, command, projectPath, {
						timeout: 120000,
					});
					const url = await waitForReady(proc);

					// Container might take time to start, so we test with retries
					let attempts = 0;
					let success = false;

					while (attempts < 10 && !success) {
						try {
							const response = await fetchJson(url + "/api/health");
							expect(response.status).toBe("healthy");
							success = true;
						} catch (error) {
							attempts++;
							if (attempts < 10) {
								// Wait 2 seconds before retry
								await new Promise((resolve) => setTimeout(resolve, 2000));
							}
						}
					}

					expect(success).toBe(true);
				}
			);

			test.skipIf(process.env.DOCKER_AVAILABLE)(
				"should handle missing Docker gracefully",
				async ({ expect }) => {
					// When Docker is not available, the dev server should still start
					// but container endpoints should return appropriate errors
					const proc = await runLongLived(pm, command, projectPath);
					const url = await waitForReady(proc);

					// Worker should start successfully
					const response = await fetch(url);
					expect(response.status).toBe(200);

					// Container endpoint should return service unavailable
					const apiResponse = await fetch(url + "/api/");
					expect(apiResponse.status).toBe(503);

					const text = await apiResponse.text();
					expect(text).toContain("Container not available");
				}
			);
		});
	});
});
