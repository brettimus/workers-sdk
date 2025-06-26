// Import mocked functions
import { prepareContainerImagesForDev } from "@cloudflare/containers-shared";
import { beforeEach, describe, expect, test, vi } from "vitest";
import {
	buildContainersForDev,
	generateContainerBuildId,
	getContainerOptionsForMiniflare,
	validateContainerConfig,
} from "../../containers/build";
import type { ContainerApp } from "../../containers/build";

// Mock the containers-shared dependency
vi.mock("@cloudflare/containers-shared", () => ({
	prepareContainerImagesForDev: vi.fn(),
	getDevContainerImageName: vi.fn(
		(className, buildId) => `cloudflare-dev/${className}:${buildId}`
	),
	cleanupContainers: vi.fn(),
}));

// Mock wrangler dependency
vi.mock("wrangler/environment-variables/misc-variables", () => ({
	getDockerPath: vi.fn(() => "docker"),
}));

describe("containers/build", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe("validateContainerConfig", () => {
		test("should pass for valid container configuration", () => {
			const containers: ContainerApp[] = [
				{
					class_name: "TestContainer",
					image: "./Dockerfile",
					instance_type: "dev",
					scheduling_policy: "default",
					rollout_kind: "full_auto",
					rollout_step_percentage: 50,
				},
			];

			expect(() => validateContainerConfig(containers)).not.toThrow();
		});

		test("should throw error for missing class_name", () => {
			const containers = [
				{
					image: "./Dockerfile",
				},
			] as any;

			expect(() => validateContainerConfig(containers)).toThrowError(
				"Container must specify a class_name"
			);
		});

		test("should throw error for missing image", () => {
			const containers: ContainerApp[] = [
				{
					class_name: "TestContainer",
					image: "",
				},
			];

			expect(() => validateContainerConfig(containers)).toThrowError(
				'Container for class "TestContainer" must specify an image'
			);
		});

		test("should throw error for invalid instance_type", () => {
			const containers = [
				{
					class_name: "TestContainer",
					image: "./Dockerfile",
					instance_type: "invalid",
				},
			] as any;

			expect(() => validateContainerConfig(containers)).toThrowError(
				'Invalid instance_type "invalid" for container "TestContainer"'
			);
		});

		test("should throw error for invalid scheduling_policy", () => {
			const containers = [
				{
					class_name: "TestContainer",
					image: "./Dockerfile",
					scheduling_policy: "invalid",
				},
			] as any;

			expect(() => validateContainerConfig(containers)).toThrowError(
				'Invalid scheduling_policy "invalid" for container "TestContainer"'
			);
		});

		test("should throw error for invalid rollout_kind", () => {
			const containers = [
				{
					class_name: "TestContainer",
					image: "./Dockerfile",
					rollout_kind: "invalid",
				},
			] as any;

			expect(() => validateContainerConfig(containers)).toThrowError(
				'Invalid rollout_kind "invalid" for container "TestContainer"'
			);
		});

		test("should throw error for invalid rollout_step_percentage", () => {
			const containers: ContainerApp[] = [
				{
					class_name: "TestContainer",
					image: "./Dockerfile",
					rollout_step_percentage: 10, // Below minimum of 25
				},
			];

			expect(() => validateContainerConfig(containers)).toThrowError(
				'Invalid rollout_step_percentage "10" for container "TestContainer"'
			);

			containers[0]!.rollout_step_percentage = 150; // Above maximum of 100
			expect(() => validateContainerConfig(containers)).toThrowError(
				'Invalid rollout_step_percentage "150" for container "TestContainer"'
			);
		});

		test("should pass for valid edge cases", () => {
			const containers: ContainerApp[] = [
				{
					class_name: "TestContainer",
					image: "./Dockerfile",
					instance_type: "basic",
					scheduling_policy: "regional",
					rollout_kind: "none",
					rollout_step_percentage: 25, // Minimum valid value
				},
				{
					class_name: "TestContainer2",
					image: "./Dockerfile2",
					instance_type: "standard",
					scheduling_policy: "moon",
					rollout_kind: "full_manual",
					rollout_step_percentage: 100, // Maximum valid value
				},
			];

			expect(() => validateContainerConfig(containers)).not.toThrow();
		});
	});

	describe("generateContainerBuildId", () => {
		test("should generate a valid UUID", () => {
			const buildId = generateContainerBuildId();

			// UUID v4 format validation
			const uuidRegex =
				/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
			expect(buildId).toMatch(uuidRegex);
		});

		test("should generate unique IDs", () => {
			const id1 = generateContainerBuildId();
			const id2 = generateContainerBuildId();

			expect(id1).not.toBe(id2);
		});
	});

	describe("getContainerOptionsForMiniflare", () => {
		test("should map containers to miniflare format", () => {
			const containers: ContainerApp[] = [
				{
					class_name: "Container1",
					image: "./Dockerfile1",
				},
				{
					class_name: "Container2",
					image: "./Dockerfile2",
				},
			];
			const buildId = "test-build-id";

			const result = getContainerOptionsForMiniflare(containers, buildId);

			expect(result).toEqual([
				{
					className: "Container1",
					imageName: "cloudflare-dev/Container1:test-build-id",
				},
				{
					className: "Container2",
					imageName: "cloudflare-dev/Container2:test-build-id",
				},
			]);
		});

		test("should handle empty containers array", () => {
			const result = getContainerOptionsForMiniflare([], "build-id");
			expect(result).toEqual([]);
		});
	});

	describe("buildContainersForDev", () => {
		test("should build containers successfully", async () => {
			vi.mocked(prepareContainerImagesForDev).mockResolvedValue(undefined);

			const containers: ContainerApp[] = [
				{
					class_name: "TestContainer",
					image: "./Dockerfile",
				},
			];

			const result = await buildContainersForDev({
				containers,
				buildId: "test-build-id",
				configRoot: "/test/root",
			});

			expect(result).toHaveLength(1);
			expect(result[0]).toEqual({
				className: "TestContainer",
				imageTag: "cloudflare-dev/TestContainer:test-build-id",
				success: true,
			});

			expect(prepareContainerImagesForDev).toHaveBeenCalledWith("docker", [
				{
					image: "./Dockerfile",
					imageTag: "cloudflare-dev/TestContainer:test-build-id",
					args: undefined,
					imageBuildContext: undefined,
					class_name: "TestContainer",
				},
			]);
		});

		test("should handle build failures", async () => {
			const error = new Error("Docker build failed");
			vi.mocked(prepareContainerImagesForDev).mockRejectedValue(error);

			const containers: ContainerApp[] = [
				{
					class_name: "TestContainer",
					image: "./Dockerfile",
				},
			];

			const result = await buildContainersForDev({
				containers,
				buildId: "test-build-id",
				configRoot: "/test/root",
			});

			expect(result).toHaveLength(1);
			expect(result[0]).toEqual({
				className: "TestContainer",
				imageTag: "cloudflare-dev/TestContainer:test-build-id",
				success: false,
				error: "Docker build failed",
			});
		});

		test("should handle empty containers array", async () => {
			const result = await buildContainersForDev({
				containers: [],
				buildId: "test-build-id",
				configRoot: "/test/root",
			});

			expect(result).toEqual([]);
			expect(prepareContainerImagesForDev).not.toHaveBeenCalled();
		});

		test("should pass container configuration correctly", async () => {
			vi.mocked(prepareContainerImagesForDev).mockResolvedValue(undefined);

			const containers: ContainerApp[] = [
				{
					class_name: "TestContainer",
					image: "./Dockerfile",
					image_build_context: "./context",
					image_vars: {
						NODE_ENV: "development",
						API_KEY: "test-key",
					},
				},
			];

			await buildContainersForDev({
				containers,
				buildId: "test-build-id",
				dockerPath: "/custom/docker",
				configRoot: "/test/root",
			});

			expect(prepareContainerImagesForDev).toHaveBeenCalledWith(
				"/custom/docker",
				[
					{
						image: "./Dockerfile",
						imageTag: "cloudflare-dev/TestContainer:test-build-id",
						args: {
							NODE_ENV: "development",
							API_KEY: "test-key",
						},
						imageBuildContext: "./context",
						class_name: "TestContainer",
					},
				]
			);
		});
	});
});
