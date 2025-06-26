import { expect, test, describe } from "vitest";
import { getTextResponse, getJsonResponse } from "../../__test-utils__";

describe("Container Integration", () => {
	test("should serve worker welcome page", async () => {
		const response = await getTextResponse("/");
		expect(response).toContain("Container Worker is running!");
		expect(response).toContain("Try /api to test the container");
	});

	test("should return 404 for unknown paths", async () => {
		try {
			await getTextResponse("/unknown");
		} catch (error: any) {
			expect(error.status).toBe(404);
		}
	});

	// Note: Container tests require Docker and are platform-dependent
	// These tests will be skipped in CI environments without Docker
	describe("Container API (requires Docker)", () => {
		test.skipIf(!process.env.DOCKER_AVAILABLE)("should proxy requests to container", async () => {
			const response = await getJsonResponse("/api");
			
			expect(response).toEqual({
				message: "Hello from the container!",
				timestamp: expect.any(String),
				environment: "development",
			});
		});

		test.skipIf(!process.env.DOCKER_AVAILABLE)("should return container health info", async () => {
			const response = await getJsonResponse("/api/health");
			
			expect(response).toEqual({
				status: "healthy",
				uptime: expect.any(Number),
				memory: expect.any(Object),
			});
		});

		test.skipIf(!process.env.DOCKER_AVAILABLE)("should handle POST requests to container", async () => {
			const testData = { message: "test from worker" };
			
			const response = await fetch("http://localhost:4321/api/echo", {
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
		});
	});

	describe("Container error handling", () => {
		// Mock scenarios where container is not available
		test.skipIf(process.env.DOCKER_AVAILABLE)("should handle missing container gracefully", async () => {
			try {
				await getTextResponse("/api");
			} catch (error: any) {
				expect(error.status).toBe(503);
				expect(error.text).toContain("Container not available");
			}
		});
	});

	describe("Durable Object functionality", () => {
		test("should maintain container state across requests", async () => {
			// Note: This test assumes container is available
			if (!process.env.DOCKER_AVAILABLE) return;

			// Make multiple requests to the same Durable Object
			const response1 = await getJsonResponse("/api/health");
			const response2 = await getJsonResponse("/api/health");
			
			// Uptime should increase between requests (same container instance)
			expect(response2.uptime).toBeGreaterThanOrEqual(response1.uptime);
		});
	});
});