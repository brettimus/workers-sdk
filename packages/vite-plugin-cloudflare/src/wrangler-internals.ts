/**
 * This file contains functionality that has been copied from the `wrangler` package.
 * This is done to avoid deep-importing from `wrangler` which is not a stable API.
 * The code in this file should be kept in sync with the original `wrangler` code.
 */

/**
 * `WRANGLER_DOCKER_BIN` specifies the path to a docker binary.
 *
 * By default it's `docker`.
 *
 * This is a copy of the `getDockerPath` function from `wrangler`.
 * @see https://github.com/cloudflare/workers-sdk/blob/main/packages/wrangler/src/environment-variables/misc-variables.ts
 */
export function getDockerPath() {
	return process.env.WRANGLER_DOCKER_BIN ?? "docker";
}