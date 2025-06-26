import * as path from "node:path";
import { describe, expect, test, vi, beforeEach, type MockedFunction } from "vitest";
import type * as vite from "vite";
import {
	containerPlugin,
	getContainerBuildId,
	resetContainerState,
} from "../../containers/plugin";
import type { WorkersResolvedConfig } from "../../plugin-config";

// Mock the build utilities
vi.mock("../../containers/build", () => ({
	buildContainersForDev: vi.fn(),
	cleanupContainerImages: vi.fn(),
	generateContainerBuildId: vi.fn(() => "mock-build-id"),
	validateContainerConfig: vi.fn(),
}));

// Mock picocolors
vi.mock("picocolors", () => ({
	default: {
		dim: vi.fn((text) => text),
		red: vi.fn((text) => text),
		yellow: vi.fn((text) => text),
	},
}));

describe("containers/plugin", () => {
	let mockServer: Partial<vite.ViteDevServer>;
	let mockConfig: WorkersResolvedConfig;

	beforeEach(() => {
		vi.clearAllMocks();
		resetContainerState();

		mockServer = {
			config: {
				root: "/test/root",
				logger: {
					info: vi.fn(),
					error: vi.fn(),
					warn: vi.fn(),
				},
			},
			restart: vi.fn(),
		} as any;

		mockConfig = {
			type: "workers",
			workers: {
				testWorker: {
					name: "test-worker",
					topLevelName: "test-worker",
					compatibility_date: "2024-04-03",
					main: "./src/index.ts",
					containers: [
						{
							class_name: "TestContainer",
							image: "./Dockerfile",
							instance_type: "dev",
						},
					],
				},
			},
			entryWorkerEnvironmentName: "testWorker",
		} as any;
	});

	describe("containerPlugin", () => {
		test("should create plugin with correct name and enforce pre", () => {
			const plugin = containerPlugin(mockConfig);

			expect(plugin.name).toBe("vite-plugin-cloudflare:containers");
			expect(plugin.enforce).toBe("pre");
		});

		test("should handle config with no containers", async () => {
			const configWithoutContainers = {
				...mockConfig,
				workers: {
					testWorker: {
						...mockConfig.workers.testWorker,
						containers: undefined,
					},
				},
			};

			const plugin = containerPlugin(configWithoutContainers);
			
			// Mock the buildStart context
			const mockContext = {
				error: vi.fn(),
			} as any;

			// Should not throw or call any build functions
			await plugin.buildStart?.call(mockContext);
			
			const { buildContainersForDev } = await import("../../containers/build");
			expect(buildContainersForDev).not.toHaveBeenCalled();
		});

		test("should build containers on buildStart", async () => {
			const { buildContainersForDev, validateContainerConfig } = await import("../../containers/build");
			vi.mocked(buildContainersForDev).mockResolvedValue([
				{
					className: "TestContainer",
					imageTag: "cloudflare-dev/TestContainer:mock-build-id",
					success: true,
				},
			]);

			const plugin = containerPlugin(mockConfig);
			plugin.configureServer?.(mockServer as vite.ViteDevServer);

			const mockContext = {
				error: vi.fn(),
			} as any;

			await plugin.buildStart?.call(mockContext);

			expect(validateContainerConfig).toHaveBeenCalledWith([
				{
					class_name: "TestContainer",
					image: "./Dockerfile",
					instance_type: "dev",
				},
			]);

			expect(buildContainersForDev).toHaveBeenCalledWith({
				containers: [
					{
						class_name: "TestContainer",
						image: "./Dockerfile",
						instance_type: "dev",
					},
				],
				buildId: "mock-build-id",
				configRoot: "/test/root",
			});
		});

		test("should handle validation errors", async () => {
			const { validateContainerConfig } = await import("../../containers/build");
			vi.mocked(validateContainerConfig).mockImplementation(() => {
				throw new Error("Invalid container configuration");
			});

			const plugin = containerPlugin(mockConfig);
			plugin.configureServer?.(mockServer as vite.ViteDevServer);

			const mockContext = {
				error: vi.fn(),
			} as any;

			await plugin.buildStart?.call(mockContext);

			expect(mockContext.error).toHaveBeenCalledWith(
				"Container configuration error: Invalid container configuration"
			);
		});

		test("should handle build failures", async () => {
			const { buildContainersForDev, validateContainerConfig } = await import("../../containers/build");
			vi.mocked(validateContainerConfig).mockImplementation(() => {});
			vi.mocked(buildContainersForDev).mockResolvedValue([
				{
					className: "TestContainer",
					imageTag: "cloudflare-dev/TestContainer:mock-build-id",
					success: false,
					error: "Docker build failed",
				},
			]);

			const plugin = containerPlugin(mockConfig);
			plugin.configureServer?.(mockServer as vite.ViteDevServer);

			const mockContext = {
				error: vi.fn(),
			} as any;

			await plugin.buildStart?.call(mockContext);

			expect(mockServer.config?.logger.error).toHaveBeenCalledWith(
				expect.stringContaining("Container build failed for")
			);
		});

		test("should detect Dockerfile changes in hotUpdate", () => {
			const plugin = containerPlugin(mockConfig);
			plugin.configureServer?.(mockServer as vite.ViteDevServer);

			// Initialize container state by calling buildStart
			const mockContext = { error: vi.fn() } as any;
			plugin.buildStart?.call(mockContext);

			const mockHotUpdateContext = {
				file: path.resolve("/test/root/Dockerfile"),
				server: mockServer,
			} as any;

			const result = plugin.hotUpdate?.(mockHotUpdateContext);

			// Should return empty array to prevent normal hot reload
			expect(result).toEqual([]);
		});

		test("should ignore non-container files in hotUpdate", () => {
			const plugin = containerPlugin(mockConfig);
			plugin.configureServer?.(mockServer as vite.ViteDevServer);

			// Initialize container state
			const mockContext = { error: vi.fn() } as any;
			plugin.buildStart?.call(mockContext);

			const mockHotUpdateContext = {
				file: "/test/root/src/index.ts",
				server: mockServer,
			} as any;

			const result = plugin.hotUpdate?.(mockHotUpdateContext);

			// Should return undefined to allow normal hot reload
			expect(result).toBeUndefined();
		});

		test("should detect files in build context", () => {
			const configWithBuildContext = {
				...mockConfig,
				workers: {
					testWorker: {
						...mockConfig.workers.testWorker,
						containers: [
							{
								class_name: "TestContainer",
								image: "./api/Dockerfile",
								image_build_context: "./api",
							},
						],
					},
				},
			};

			const plugin = containerPlugin(configWithBuildContext);
			plugin.configureServer?.(mockServer as vite.ViteDevServer);

			// Initialize container state
			const mockContext = { error: vi.fn() } as any;
			plugin.buildStart?.call(mockContext);

			const mockHotUpdateContext = {
				file: path.resolve("/test/root/api/package.json"),
				server: mockServer,
			} as any;

			const result = plugin.hotUpdate?.(mockHotUpdateContext);

			// Should return empty array for files in build context
			expect(result).toEqual([]);
		});

		test("should ignore node_modules in build context", () => {
			const plugin = containerPlugin(mockConfig);
			plugin.configureServer?.(mockServer as vite.ViteDevServer);

			// Initialize container state
			const mockContext = { error: vi.fn() } as any;
			plugin.buildStart?.call(mockContext);

			const mockHotUpdateContext = {
				file: path.resolve("/test/root/node_modules/some-package/index.js"),
				server: mockServer,
			} as any;

			const result = plugin.hotUpdate?.(mockHotUpdateContext);

			// Should return undefined for ignored files
			expect(result).toBeUndefined();
		});

		test("should cleanup containers on closeBundle", async () => {
			const { cleanupContainerImages } = await import("../../containers/build");

			const plugin = containerPlugin(mockConfig);
			plugin.configureServer?.(mockServer as vite.ViteDevServer);

			// Initialize container state with some images
			const mockContext = { error: vi.fn() } as any;
			await plugin.buildStart?.call(mockContext);

			await plugin.closeBundle?.call(mockContext);

			expect(cleanupContainerImages).toHaveBeenCalled();
		});

		test("should handle cleanup failures gracefully", async () => {
			const { cleanupContainerImages } = await import("../../containers/build");
			vi.mocked(cleanupContainerImages).mockRejectedValue(new Error("Cleanup failed"));

			const plugin = containerPlugin(mockConfig);
			plugin.configureServer?.(mockServer as vite.ViteDevServer);

			// Initialize container state
			const mockContext = { error: vi.fn() } as any;
			await plugin.buildStart?.call(mockContext);

			// Should not throw
			await plugin.closeBundle?.call(mockContext);

			expect(mockServer.config?.logger.warn).toHaveBeenCalledWith(
				expect.stringContaining("Failed to clean up container images")
			);
		});
	});

	describe("getContainerBuildId", () => {
		test("should return undefined when no container state", () => {
			resetContainerState();
			expect(getContainerBuildId()).toBeUndefined();
		});

		test("should return build ID after plugin initialization", async () => {
			const plugin = containerPlugin(mockConfig);
			plugin.configureServer?.(mockServer as vite.ViteDevServer);

			const mockContext = { error: vi.fn() } as any;
			await plugin.buildStart?.call(mockContext);

			expect(getContainerBuildId()).toBe("mock-build-id");
		});
	});

	describe("resetContainerState", () => {
		test("should reset container state", async () => {
			const plugin = containerPlugin(mockConfig);
			plugin.configureServer?.(mockServer as vite.ViteDevServer);

			const mockContext = { error: vi.fn() } as any;
			await plugin.buildStart?.call(mockContext);

			expect(getContainerBuildId()).toBe("mock-build-id");

			resetContainerState();
			expect(getContainerBuildId()).toBeUndefined();
		});
	});

	describe("container file detection", () => {
		test("should detect dockerfile with absolute path", () => {
			const configWithAbsolutePath = {
				...mockConfig,
				workers: {
					testWorker: {
						...mockConfig.workers.testWorker,
						containers: [
							{
								class_name: "TestContainer",
								image: "/absolute/path/to/Dockerfile",
							},
						],
					},
				},
			};

			const plugin = containerPlugin(configWithAbsolutePath);
			plugin.configureServer?.(mockServer as vite.ViteDevServer);

			const mockContext = { error: vi.fn() } as any;
			plugin.buildStart?.call(mockContext);

			const mockHotUpdateContext = {
				file: "/absolute/path/to/Dockerfile",
				server: mockServer,
			} as any;

			const result = plugin.hotUpdate?.(mockHotUpdateContext);
			expect(result).toEqual([]);
		});

		test("should ignore registry URLs", () => {
			const configWithRegistryUrl = {
				...mockConfig,
				workers: {
					testWorker: {
						...mockConfig.workers.testWorker,
						containers: [
							{
								class_name: "TestContainer",
								image: "https://registry.example.com/my-image:latest",
							},
						],
					},
				},
			};

			const plugin = containerPlugin(configWithRegistryUrl);
			plugin.configureServer?.(mockServer as vite.ViteDevServer);

			const mockContext = { error: vi.fn() } as any;
			plugin.buildStart?.call(mockContext);

			const mockHotUpdateContext = {
				file: "/test/root/Dockerfile",
				server: mockServer,
			} as any;

			const result = plugin.hotUpdate?.(mockHotUpdateContext);
			// Should not detect this as a container file since image is a URL
			expect(result).toBeUndefined();
		});
	});
});