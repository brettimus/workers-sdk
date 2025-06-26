import * as path from "node:path";
import colors from "picocolors";
import * as vite from "vite";
import {
	buildContainersForDev,
	cleanupContainerImages,
	ContainerApp,
	generateContainerBuildId,
	validateContainerConfig,
} from "./build";
import type { WorkersResolvedConfig } from "../plugin-config";

export interface ContainerPluginState {
	buildId: string;
	imageTagsSeen: Set<string>;
	isBuilding: boolean;
	lastBuildTime: number;
}

// Global state for container management
let containerState: ContainerPluginState | undefined;
let rebuildTimeout: NodeJS.Timeout | undefined;

/**
 * Vite plugin to handle container building and hot reload for Cloudflare Workers
 */
export function containerPlugin(
	resolvedPluginConfig: WorkersResolvedConfig
): vite.Plugin {
	let server: vite.ViteDevServer | undefined;
	
	// Debounced rebuild function
	const debounceMs = 300;

	function handleContainerFileChange(filePath: string) {
		if (rebuildTimeout) {
			clearTimeout(rebuildTimeout);
		}

		rebuildTimeout = setTimeout(async () => {
			if (!containerState || !server) return;

			// Generate new build ID for hot reload
			containerState.buildId = generateContainerBuildId();

			server.config.logger.info(colors.dim(`⎔ Container file changed: ${path.relative(server.config.root, filePath)}`));
			server.config.logger.info(colors.dim("⎔ Rebuilding containers..."));

			// Collect all containers again
			const allContainers: ContainerApp[] = [];
			for (const worker of Object.values(resolvedPluginConfig.workers)) {
				if (worker.containers) {
					allContainers.push(...worker.containers);
				}
			}

			await buildContainers(allContainers, server.config.root);

			// Restart the server to pick up new container images
			server.restart();
		}, debounceMs);
	}

	return {
		name: "vite-plugin-cloudflare:containers",
		enforce: "pre", // Run before the main cloudflare plugin
		
		configureServer(viteDevServer) {
			server = viteDevServer;
		},

		async buildStart() {
			// Check if any workers have containers configured
			const hasContainers = Object.values(resolvedPluginConfig.workers).some(
				worker => worker.containers && worker.containers.length > 0
			);

			if (!hasContainers) {
				return;
			}

			// Initialize container state if not already done
			if (!containerState) {
				containerState = {
					buildId: generateContainerBuildId(),
					imageTagsSeen: new Set(),
					isBuilding: false,
					lastBuildTime: 0,
				};
			}

			// Collect all containers from all workers
			const allContainers: ContainerApp[] = [];
			for (const worker of Object.values(resolvedPluginConfig.workers)) {
				if (worker.containers) {
					allContainers.push(...worker.containers);
				}
			}

			// Validate container configuration
			try {
				validateContainerConfig(allContainers);
			} catch (error) {
				this.error(`Container configuration error: ${error instanceof Error ? error.message : error}`);
				return;
			}

			if (allContainers.length === 0) {
				return;
			}

			// Build containers
			await buildContainers(allContainers, server?.config.root);
		},

		hotUpdate(options) {
			if (!containerState || !server) {
				return;
			}

			// Check if the changed file is a Dockerfile or related to container building
			const changedFilePath = path.resolve(options.file);
			const isContainerFile = isDockerRelatedFile(changedFilePath, resolvedPluginConfig);

			if (isContainerFile) {
				// Trigger container rebuild
				handleContainerFileChange(changedFilePath);
				// Return empty array to prevent normal hot reload
				return [];
			}
		},

		async closeBundle() {
			// Clean up containers when the dev server shuts down
			if (containerState && containerState.imageTagsSeen.size > 0) {
				try {
					server?.config.logger.info(colors.dim("⎔ Cleaning up container images..."));
					await cleanupContainerImages(containerState.imageTagsSeen);
				} catch (error) {
					server?.config.logger.warn(
						colors.yellow("Failed to clean up container images. You may need to clean them up manually.")
					);
				}
			}
		},
	};

	async function buildContainers(containers: ContainerApp[], configRoot?: string) {
		if (!containerState || containerState.isBuilding) {
			return;
		}

		containerState.isBuilding = true;
		const startTime = Date.now();

		try {
			server?.config.logger.info(colors.dim("⎔ Building container images..."));

			const results = await buildContainersForDev({
				containers,
				buildId: containerState.buildId,
				configRoot: configRoot || process.cwd(),
			});

			// Track built image tags for cleanup
			results.forEach(result => {
				if (result.success) {
					containerState?.imageTagsSeen.add(result.imageTag);
				}
			});

			// Check for build failures
			const failures = results.filter(r => !r.success);
			if (failures.length > 0) {
				const failureMessages = failures.map(f => 
					`  - ${f.className}: ${f.error || 'Unknown error'}`
				).join('\n');
				
				server?.config.logger.error(
					colors.red(`Container build failed for:\n${failureMessages}`)
				);
			} else {
				const buildTime = Date.now() - startTime;
				server?.config.logger.info(
					colors.dim(`⎔ Container images built in ${buildTime}ms`)
				);
			}

			containerState.lastBuildTime = startTime;
		} catch (error) {
			server?.config.logger.error(
				colors.red(`Container build error: ${error instanceof Error ? error.message : error}`)
			);
		} finally {
			containerState.isBuilding = false;
		}
	}

	function isDockerRelatedFile(filePath: string, config: WorkersResolvedConfig): boolean {
		for (const worker of Object.values(config.workers)) {
			if (!worker.containers) continue;

			for (const container of worker.containers) {
				if (!container.image || container.image.startsWith('http')) continue;

				// Resolve Dockerfile path
				let dockerfilePath = container.image;
				if (!path.isAbsolute(dockerfilePath)) {
					dockerfilePath = path.resolve(server?.config.root || process.cwd(), dockerfilePath);
				}

				// Check if this is the Dockerfile
				if (filePath === dockerfilePath) {
					return true;
				}

				// Check if this is in the build context
				let contextPath = container.image_build_context;
				if (!contextPath) {
					contextPath = path.dirname(dockerfilePath);
				} else if (!path.isAbsolute(contextPath)) {
					contextPath = path.resolve(server?.config.root || process.cwd(), contextPath);
				}

				if (filePath.startsWith(contextPath)) {
					// Ignore certain files that don't affect container builds
					const relativePath = path.relative(contextPath, filePath);
					const ignoredPatterns = [
						/node_modules/,
						/\.git/,
						/\.DS_Store/,
						/Thumbs\.db/,
						/\.log$/,
						/\.vite/,
						/dist\//,
					];

					if (!ignoredPatterns.some(pattern => pattern.test(relativePath))) {
						return true;
					}
				}
			}
		}

		return false;
	}
}

/**
 * Get the current container build ID for Miniflare integration
 */
export function getContainerBuildId(): string | undefined {
	return containerState?.buildId;
}

/**
 * Reset container state (useful for testing)
 */
export function resetContainerState(): void {
	containerState = undefined;
}