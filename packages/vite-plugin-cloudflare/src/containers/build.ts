import { randomUUID } from "node:crypto";
import {
	cleanupContainers,
	getDevContainerImageName,
	prepareContainerImagesForDev,
} from "@cloudflare/containers-shared";
import { getDockerPath } from "../wrangler-internals";
import type { ContainerDevOptions } from "@cloudflare/containers-shared";

// Container configuration as defined in Wrangler
export interface ContainerApp {
	name?: string;
	class_name: string;
	image: string;
	image_build_context?: string;
	image_vars?: Record<string, string>;
	max_instances?: number;
	instance_type?: "dev" | "basic" | "standard";
	scheduling_policy?: "regional" | "moon" | "default";
	rollout_step_percentage?: number;
	rollout_kind?: "full_auto" | "none" | "full_manual";
}

export interface ContainerBuildResult {
	className: string;
	imageTag: string;
	success: boolean;
	error?: string;
}

export interface ContainerBuildOptions {
	containers: ContainerApp[];
	buildId: string;
	dockerPath?: string;
	configRoot: string;
}

/**
 * Builds container images for development, following Wrangler's approach
 */
export async function buildContainersForDev(
	options: ContainerBuildOptions
): Promise<ContainerBuildResult[]> {
	const { containers, buildId, configRoot } = options;

	if (!containers.length) {
		return [];
	}

	const dockerPath = options.dockerPath ?? getDockerPath();
	const containerOptions: ContainerDevOptions[] = [];
	const results: ContainerBuildResult[] = [];

	// Convert vite plugin container config to containers-shared format
	for (const container of containers) {
		const imageTag = getDevContainerImageName(container.class_name, buildId);

		containerOptions.push({
			image: container.image,
			imageTag,
			args: container.image_vars,
			imageBuildContext: container.image_build_context,
			class_name: container.class_name,
		});

		results.push({
			className: container.class_name,
			imageTag,
			success: false, // Will be updated after build
		});
	}

	try {
		// Use Wrangler's container building infrastructure
		await prepareContainerImagesForDev(dockerPath, containerOptions);

		// Mark all as successful
		results.forEach((result) => {
			result.success = true;
		});
	} catch (error) {
		// Mark all as failed with the error
		const errorMessage = error instanceof Error ? error.message : String(error);
		results.forEach((result) => {
			result.success = false;
			result.error = errorMessage;
		});
	}

	return results;
}

/**
 * Generates a build ID for container images
 */
export function generateContainerBuildId(): string {
	return randomUUID();
}

/**
 * Cleans up container images created during development
 */
export async function cleanupContainerImages(
	imageTagsSeen: Set<string>,
	dockerPath?: string
): Promise<void> {
	if (imageTagsSeen.size === 0) {
		return;
	}

	const resolvedDockerPath = dockerPath ?? getDockerPath();
	await cleanupContainers(resolvedDockerPath, imageTagsSeen);
}

/**
 * Validates container configuration
 */
export function validateContainerConfig(containers: ContainerApp[]): void {
	for (const container of containers) {
		if (!container.class_name) {
			throw new Error("Container must specify a class_name");
		}

		if (!container.image) {
			throw new Error(
				`Container for class "${container.class_name}" must specify an image`
			);
		}

		// Validate instance_type if provided
		if (
			container.instance_type &&
			!["dev", "basic", "standard"].includes(container.instance_type)
		) {
			throw new Error(
				`Invalid instance_type "${container.instance_type}" for container "${container.class_name}". Must be one of: dev, basic, standard`
			);
		}

		// Validate scheduling_policy if provided
		if (
			container.scheduling_policy &&
			!["regional", "moon", "default"].includes(container.scheduling_policy)
		) {
			throw new Error(
				`Invalid scheduling_policy "${container.scheduling_policy}" for container "${container.class_name}". Must be one of: regional, moon, default`
			);
		}

		// Validate rollout_kind if provided
		if (
			container.rollout_kind &&
			!["full_auto", "none", "full_manual"].includes(container.rollout_kind)
		) {
			throw new Error(
				`Invalid rollout_kind "${container.rollout_kind}" for container "${container.class_name}". Must be one of: full_auto, none, full_manual`
			);
		}

		// Validate rollout_step_percentage if provided
		if (container.rollout_step_percentage !== undefined) {
			if (
				container.rollout_step_percentage < 25 ||
				container.rollout_step_percentage > 100
			) {
				throw new Error(
					`Invalid rollout_step_percentage "${container.rollout_step_percentage}" for container "${container.class_name}". Must be between 25 and 100`
				);
			}
		}
	}
}

/**
 * Gets container options for Miniflare integration
 */
export function getContainerOptionsForMiniflare(
	containers: ContainerApp[],
	buildId: string
): Array<{ className: string; imageName: string }> {
	return containers.map((container) => ({
		className: container.class_name,
		imageName: getDevContainerImageName(container.class_name, buildId),
	}));
}
