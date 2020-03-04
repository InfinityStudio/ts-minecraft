import { MinecraftFolder, MinecraftLocation, ResolvedLibrary, ResolvedVersion, Version as VersionJson } from "@xmcl/core";
import { ensureDir, readFile } from "@xmcl/core/fs";
import Task from "@xmcl/task";
import { cpus } from "os";
import { join } from "path";
import { Downloader, downloadFileIfAbsentTask, DownloadStrategy, getIfUpdate, UpdatedObject } from "./util";

/**
 * The function to swap library host.
 */
export type LibraryHost = (library: ResolvedLibrary) => string | string[] | undefined;

/**
 * The version metadata containing the version information, like download url
 */
export interface Version {
    id: string;
    type: string;
    time: string;
    releaseTime: string;
    url: string;
}
/**
 * Minecraft version metadata list
 */
export interface VersionList extends UpdatedObject {
    latest: {
        /**
         * Snapshot version id of the Minecraft
         */
        snapshot: string
        /**
         * Release version id of the Minecraft, like 1.14.2
         */
        release: string,
    };
    /**
     * All the vesrsion list
     */
    versions: Version[];
}

/**
 * Default minecraft version manifest url.
 */
export const DEFAULT_VERSION_MANIFEST_URL = "https://launchermeta.mojang.com/mc/game/version_manifest.json";
/**
 * Default resource/assets url root
 */
export const DEFAULT_RESOURCE_ROOT_URL = "https://resources.download.minecraft.net";

/**
 * Get and update the version list.
 * This try to send http GET request to offical Minecraft metadata endpoint by default.
 * You can swap the endpoint by passing url on `remote` in option.
 *
 * @returns The new list if there is
 */
export function getVersionList(option: {
    /**
     * If this presents, it will send request with the original list timestamp.
     *
     * If the server believes there is no modification after the original one,
     * it will directly return the orignal one.
     */
    original?: VersionList,
    /**
     * remote url of this request
     */
    remote?: string,
} = {}): Promise<VersionList> {
    return getIfUpdate(option.remote || DEFAULT_VERSION_MANIFEST_URL, JSON.parse, option.original);
}
export interface DownloaderOption {
    /**
     * An external downloader.
     *
     * If this is assigned, the returned task won't be able to track progress.
     * You should track the download progress by you self.
     */
    downloader?: Downloader;

    /**
     * An hook to decide should we download a resource.
     *
     * The default strategy will check the checksum and the existence of the file to decide should we download the file.
     */
    downloadStrategy?: DownloadStrategy;

    /**
     * Should hault the donwload process immediately after ANY resource download failed.
     */
    throwErrorImmediately?: boolean;
}
/**
 * Change the library host url
 */
export interface LibraryOption extends DownloaderOption {
    /**
     * Assign this to swap library host.
     */
    libraryHost?: LibraryHost;
}
/**
 * Change the host url of assets download
 */
export interface AssetsOption extends DownloaderOption {
    /**
     * Swap customized assets download host.
     */
    assetsHost?: string | string[];
    /**
     * Control how many assets download task should run at the same time.
     */
    assetsDownloadConcurrency?: number;
}
/**
 * Replace the minecraft client or server jar download
 */
export interface JarOption extends DownloaderOption {
    /**
     * The client jar url
     */
    client?: string;
    /**
     * The server jar url
     */
    server?: string;
}
export type Option = AssetsOption & JarOption & LibraryOption;

type RequiredVersion = Pick<Version, "id" | "url">

/**
 * The collection of errors happened during a parallel process
 */
export class MultipleError extends Error {
    constructor(public errors: any[]) { super(); };
}
/**
 * Install the Minecraft game to a location by version metadata.
 *
 * This will install version json, version jar, and all dependencies (assets, libraries)
 *
 * @param type The type of game, client or server
 * @param versionMeta The version metadata
 * @param minecraft The Minecraft location
 * @param option
 */
export function install(type: "server" | "client", versionMeta: RequiredVersion, minecraft: MinecraftLocation, option?: Option): Promise<ResolvedVersion> {
    return Task.execute(installTask(type, versionMeta, minecraft, option)).wait();
}
/**
 * Install the Minecraft game to a location by version metadata
 *
 * This will install version json, version jar, and all dependencies (assets, libraries)
 *
 * Tasks emmitted:
 * - install
 *  - installVersion
 *   - json
 *   - jar
 *  - installDependencies
 *   - installAssets
 *     - assetsJson
 *     - asset
 *   - installLibraries
 *     - library
 *
 * @param type The type of game, client or server
 * @param versionMeta The version metadata
 * @param minecraft The Minecraft location
 * @param option
 */
export function installTask(type: "server" | "client", versionMeta: RequiredVersion, minecraft: MinecraftLocation, option: Option = {}): Task<ResolvedVersion> {
    return Task.create("install", async function install(context: Task.Context) {
        context.update(0, 100);
        const version = await context.execute(installVersionTask(type, versionMeta, minecraft, option), 20);
        if (type === "client") {
            await context.execute(installDependenciesTask(version, option), 80);
        } else {
            await context.execute(installLibrariesTask(version, option), 80);
        }
        return version;
    }, { version: versionMeta.id });
}

/**
 * Only install the json/jar. Do not install dependencies.
 *
 * @param type client or server
 * @param versionMeta the version metadata; get from updateVersionMeta
 * @param minecraft minecraft location
 */
export function installVersion(type: "client" | "server", versionMeta: Version, minecraft: MinecraftLocation, option: JarOption = {}): Promise<ResolvedVersion> {
    return Task.execute(installVersionTask(type, versionMeta, minecraft, option)).wait();
}

/**
 * Only install the json/jar. Do not check dependencies;
 *
 * Task emmitted:
 * - installVersion
 *   - json
 *   - jar
 *
 * @param type client or server
 * @param versionMeta the version metadata; get from updateVersionMeta
 * @param minecraft minecraft location
 */
export function installVersionTask(type: "client" | "server", versionMeta: RequiredVersion, minecraft: MinecraftLocation, option: JarOption = {}): Task<ResolvedVersion> {
    return Task.create("installVersion", async function installVersion(context: Task.Context) {
        context.update(0, 100);
        await context.execute(installVersionJsonTask(versionMeta, minecraft, option), 40);
        const version = await VersionJson.parse(minecraft, versionMeta.id);
        await context.execute(installVersionJarTask(type, version, minecraft, option), 60);
        return version;
    }, { version: versionMeta.id });
}

/**
 * Install the completeness of the Minecraft game assets and libraries on a existed version.
 *
 * @param version The resolved version produced by Version.parse
 * @param minecraft The minecraft location
 */
export function installDependencies(version: ResolvedVersion, option?: Option): Promise<ResolvedVersion> {
    return Task.execute(installDependenciesTask(version, option)).wait();
}
/**
 * Install the completeness of the Minecraft game assets and libraries.
 *
 * Tasks emitted:
 * - installDependencies
 *  - installAssets
 *   - assetsJson
 *   - asset
 *  - installLibraries
 *   - library
 *
 * @param version The resolved version produced by Version.parse
 * @param minecraft The minecraft location
 */
export function installDependenciesTask(version: ResolvedVersion, option: Option = {}): Task<ResolvedVersion> {
    return Task.create("installDependencies", async function installDependencies(context: Task.Context) {
        context.update(0, 100);
        await Promise.all([
            context.execute(installAssetsTask(version, option), 50),
            context.execute(installLibrariesTask(version, option), 50),
        ]);
        return version;
    }, { version: version.id });
}

/**
 * Install or check the assets to resolved version
 * @param version The target version
 * @param option The option to replace assets host url
 */
export function installAssets(version: ResolvedVersion, option?: AssetsOption): Promise<ResolvedVersion> {
    return Task.execute(installAssetsTask(version, option)).wait();
}

/**
 * Install or check the assets to resolved version
 *
 * Task emitted:
 * - installAssets
 *  - assetsJson
 *  - asset
 *
 * @param version The target version
 * @param option The option to replace assets host url
 */
export function installAssetsTask(version: ResolvedVersion, option: AssetsOption = {}): Task<ResolvedVersion> {
    async function installAssets(context: Task.Context) {
        let folder = MinecraftFolder.from(version.minecraftDirectory);
        let jsonPath = folder.getPath("assets", "indexes", version.assets + ".json");

        await context.execute(Task.create("assetsJson", function assetsJson(work) {
            let worker = option.downloader;
            let strategy = option.downloadStrategy;

            return downloadFileIfAbsentTask({
                url: version.assetIndex.url,
                destination: jsonPath,
                checksum: {
                    algorithm: "sha1",
                    hash: version.assetIndex.sha1,
                },
            }, worker, strategy)(work);
        }));

        interface AssetIndex {
            objects: {
                [key: string]: {
                    hash: string,
                    size: number,
                };
            };
        }
        let { objects } = JSON.parse(await readFile(jsonPath).then((b) => b.toString())) as AssetIndex;
        await ensureDir(folder.getPath("assets", "objects"));
        let objectArray = Object.keys(objects).map((k) => ({ name: k, ...objects[k] }));

        let totalSize = objectArray.reduce((p, v) => p + v.size, 0);
        let totalCount = objectArray.length;
        let downloadedSize = 0;

        context.update(downloadedSize, totalSize);

        let updateTotal = (size: number) => {
            context.update(downloadedSize += size, totalSize);
        };

        let errors = [] as any[];

        async function startWorker(): Promise<void> {
            if (objectArray.length === 0) {
                return Promise.resolve();
            }
            try {
                await context.execute(installAssetsWorkerTask(version.id, objectArray, folder, option, updateTotal));
            } catch (e) {
                if (!option.throwErrorImmediately) {
                    errors.push(e);
                    return startWorker();
                }
                throw e;
            }
        }

        let cores = Math.min(totalCount, option.assetsDownloadConcurrency || cpus().length * 3);
        let all = [];
        for (let i = 0; i < cores; ++i) {
            all.push(startWorker());
        }

        await Promise.all(all);

        if (errors.length !== 0) {
            throw new MultipleError(errors);
        }

        return version;
    }
    return Task.create("installAssets", installAssets, { version: version.id })
}

/**
 * Install all the libraries of providing version
 * @param version The target version
 * @param option The library host swap option
 */
export function installLibraries(version: ResolvedVersion, option: LibraryOption = {}): Promise<ResolvedVersion> {
    return Task.execute(installLibrariesTask(version, option)).wait();
}
/**
 * Install all the libraries of providing version
 *
 * Task emmitted:
 * - installLibraries
 *  - library
 *
 * @param version The target version
 * @param option The library host swap option
 */
export function installLibrariesTask<T extends Pick<ResolvedVersion, "minecraftDirectory" | "libraries">>(version: T, option: LibraryOption = {}): Task<T> {
    return Task.create("installLibraries", async function installLibraries(context: Task.Context) {
        let folder = MinecraftFolder.from(version.minecraftDirectory);
        let total = version.libraries.length * 10;
        context.update(0, total);
        let errors: any[] = [];
        let promises = version.libraries.map((lib) => context.execute(installLibraryTask(lib, folder, option), 10).catch((e) => {
            if (option.throwErrorImmediately) {
                throw e;
            } else {
                errors.push(e);
            }
        }));
        await Promise.all(promises);
        if (errors.length !== 0) {
            throw new MultipleError(errors);
        }
        return version;
    }, { version: Reflect.get(version, "id") || "" });
}

/**
 * Only install several resolved libraries
 * @param libraries The resolved libraries
 * @param minecraft The minecraft location
 * @param option The install option
 */
export function installResolvedLibraries(libraries: ResolvedLibrary[], minecraft: MinecraftLocation, option?: LibraryOption): Promise<void> {
    return Task.execute(installResolvedLibrariesTask(libraries, minecraft, option)).wait();
}

/**
 * Only install several resolved libraries.
 *
 * Task emmitted:
 * - installLibraries
 *  - library
 *
 * @param libraries The resolved libraries
 * @param minecraft The minecraft location
 * @param option The install option
 */
export function installResolvedLibrariesTask(libraries: ResolvedLibrary[], minecraft: MinecraftLocation, option?: LibraryOption): Task<void> {
    return new Proxy(installLibrariesTask({ libraries, minecraftDirectory: typeof minecraft === "string" ? minecraft : minecraft.root }, option), {
        async apply(target, thisArgs, args) {
            await target.run(args[0]);
        },
    }) as any;
}

function installVersionJsonTask(version: RequiredVersion, minecraft: MinecraftLocation, option: Option) {
    return Task.create("json", async function json(context: Task.Context) {
        let folder = MinecraftFolder.from(minecraft);
        await ensureDir(folder.getVersionRoot(version.id));

        let destination = folder.getVersionJson(version.id);
        let url = version.url;
        let expectSha1 = version.url.split("/")[5];

        await downloadFileIfAbsentTask({
            url,
            checksum: { algorithm: "sha1", hash: expectSha1 },
            destination: destination,
        }, option.downloader, option.downloadStrategy)(context);
    });
}

function installVersionJarTask(type: "client" | "server", version: ResolvedVersion, minecraft: MinecraftLocation, option: Option) {
    return Task.create("jar", async function jar(context: Task.Context) {
        const folder = MinecraftFolder.from(minecraft);
        await ensureDir(folder.getVersionRoot(version.id));

        const destination = join(folder.getVersionRoot(version.id),
            type === "client" ? version.id + ".jar" : version.id + "-" + type + ".jar");
        const url = option[type] || version.downloads[type].url;
        const expectSha1 = version.downloads[type].sha1;

        await downloadFileIfAbsentTask({
            url,
            checksum: { algorithm: "sha1", hash: expectSha1 },
            destination: destination,
        }, option.downloader, option.downloadStrategy)(context);
        return version;
    });
}

function installLibraryTask(lib: ResolvedLibrary, folder: MinecraftFolder, option: Option) {
    return Task.create("library", async function library(context: Task.Context) {
        const fallbackMavens = ["https://repo1.maven.org/maven2/"];

        context.update(0, -1, lib.name);

        const libraryPath = lib.download.path;
        const filePath = join(folder.libraries, libraryPath);
        const urls: string[] = [lib.download.url, ...fallbackMavens.map((m) => `${m}${lib.download.path}`)];
        // user defined alternative host to download
        const libraryHosts = option.libraryHost?.(lib);

        if (typeof libraryHosts === "string") {
            urls.unshift(libraryHosts);
        } else if (libraryHosts instanceof Array) {
            urls.unshift(...libraryHosts);
        }

        const checksum = lib.download.sha1 === "" ? undefined : {
            algorithm: "sha1",
            hash: lib.download.sha1,
        }

        await downloadFileIfAbsentTask({
            url: urls,
            checksum,
            destination: filePath,
        }, option.downloader, option.downloadStrategy)(context);
    }, { lib: lib.name });
}

function installAssetsWorkerTask(version: string, pool: Array<{ name: string, hash: string, size: number }>, folder: MinecraftFolder, assetsOption: AssetsOption, finishCallback: (size: number) => void) {
    return Task.create("assets", async function assets(context: Task.Context) {
        const assetsHosts = [DEFAULT_RESOURCE_ROOT_URL];

        if (typeof assetsOption.assetsHost === "string") {
            assetsHosts.unshift(assetsOption.assetsHost);
        } else if (assetsOption.assetsHost instanceof Array) {
            assetsHosts.unshift(...assetsOption.assetsHost);
        }

        while (pool.length > 0) {
            const { hash, size } = pool.pop()!;

            const head = hash.substring(0, 2);
            const dir = folder.getPath("assets", "objects", head);
            const file = join(dir, hash);
            const urls = assetsHosts.map((h) => `${h}/${head}/${hash}`);

            context.update(0, size, urls[0]);

            await downloadFileIfAbsentTask({
                url: urls,
                checksum: {
                    hash,
                    algorithm: "sha1",
                },
                destination: file,
            }, assetsOption.downloader, assetsOption.downloadStrategy)(context);
            finishCallback(size);
        }
    }, { version });
}
