import { checksum, ensureFile, missing, writeFile } from "@xmcl/core/fs";
import Task from "@xmcl/task";
import { ExecOptions, spawn } from "child_process";
import { createReadStream, createWriteStream, ReadStream } from "fs";
import gotDefault from "got";
import { IncomingMessage } from "http";
import { pipeline as pip, Writable } from "stream";
import { fileURLToPath, parse } from "url";
import { promisify } from "util";
import HttpAgent, { HttpsAgent } from "agentkeepalive";
import { ProxyStream } from "got/dist/source/as-stream";

const pipeline = promisify(pip);

const IS_ELECTRON = false; // process.versions.hasOwnProperty("electron");

export interface UpdatedObject {
    timestamp: string;
}

export const got = gotDefault.extend({
    useElectronNet: IS_ELECTRON,
});

export const fetchJson = gotDefault.extend({
    responseType: "json",
    useElectronNet: IS_ELECTRON,
});

export const fetchBuffer = gotDefault.extend({
    responseType: "buffer",
    useElectronNet: IS_ELECTRON,
});

export async function getRawIfUpdate(url: string, timestamp?: string): Promise<{ timestamp: string; content: string | undefined }> {
    const headers: Record<string, string> = {
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/80.0.3987.87 Safari/537.36 Edg/80.0.361.48",
    };
    if (typeof timestamp === "string") {
        headers["If-Modified-Since"] = timestamp;
    }
    const resp = await got(url, {
        encoding: "utf8",
        headers,
    });
    const lastModifiedReturn = resp.headers["last-modified"] || resp.headers["Last-Modified"] as string || "";
    if (resp.statusCode === 304) {
        return { timestamp: lastModifiedReturn, content: undefined };
    }
    return {
        timestamp: lastModifiedReturn,
        content: resp.body,
    };
}

export async function getIfUpdate<T extends UpdatedObject>(url: string, parser: (s: string) => any, lastObject: T | undefined): Promise<T> {
    const { content, timestamp } = await getRawIfUpdate(url, lastObject?.timestamp);
    if (content) {
        return {
            ...parser(content),
            timestamp,
        };
    }
    return lastObject!; // this cannot be undefined as the content be null only and only if the lastObject is presented.
}

export interface DownloadOption {
    url: string | string[];
    retry?: number;
    method?: "GET" | "POST" | "PUT" | "PATCH" | "HEAD" | "DELETE" | "OPTIONS" | "TRACE" | "get" | "post" | "put" | "patch" | "head" | "delete" | "options" | "trace";
    headers?: { [key: string]: string };
    timeout?: number;
    /**
     * If user wants to know the progress, pass this in, and `Downloader` should call this when there is a progress.
     * @param chunkLength The length of just transferred chunk
     * @param written The chunk already written to the disk
     * @param total The total bytes of the download file
     * @param url The remote url of the file
     */
    progress?: (chunkLength: number, written: number, total: number, url: string) => boolean | void;
    /**
     * If user wants to pause/resume the download, pass this in, and `Downloader` should call this to tell user how to pause and resume.
     */
    pausable?: (pauseFunc: () => void, resumeFunc: () => void) => void;
}

export interface DownloadToOption extends DownloadOption {
    destination: string;
    checksum?: {
        algorithm: string,
        hash: string,
    };
}

export interface Downloader {
    /**
     * Download file to the disk
     *
     * @returns The downloaded file full path
     */
    downloadFile(option: DownloadToOption): Promise<void>;
}

export interface DownloadStrategy {
    /**
     * Determine if the `Downloader` should download this resource.
     *
     * @returns Should `Downloader` download
     */
    shouldDownload(option: DownloadToOption): Promise<boolean>;
}

/**
 * The default downloader based on gotjs
 */
export class DefaultDownloader implements Downloader, DownloadStrategy {
    constructor(readonly requster = got.extend({
        agent: {
            http: new HttpAgent(),
            https: new HttpsAgent(),
        } as any,
        followRedirect: true,
    })) { }

    protected openDownloadStream(url: string, option: DownloadOption) {
        let onProgress = option.progress || (() => { });
        let stream: ReadStream | ProxyStream;

        let parsedURL = parse(url);
        if (parsedURL.protocol === "file:") {
            let path = fileURLToPath(url);
            let read = 0;
            stream = createReadStream(path).on("data", (chunk) => {
                read += chunk.length;
                if (onProgress(chunk.length, read, stream.readableLength, url)) {
                    stream.destroy();
                }
            });
        } else {
            let response: IncomingMessage;
            let lastTransferred = 0;
            stream = this.requster.stream(url, {
                method: option.method,
                headers: option.headers,
                timeout: option.timeout,
                retry: option.retry,
            }).on("response", (resp) => {
                response = resp;
            }).on("downloadProgress", (progress) => {
                let chunkLength = progress.transferred - lastTransferred;
                lastTransferred = progress.transferred;
                if (onProgress(chunkLength, progress.transferred, progress.total || -1, url)) {
                    response.destroy(new Task.CancelledError());
                }
            });
        }
        option.pausable?.(stream.pause, stream.resume);
        return stream;
    }
    /**
     * Download file by the option provided.
     */
    async downloadFile(option: DownloadToOption): Promise<void> {
        await ensureFile(option.destination);

        if (typeof option.url === "string") {
            await pipeline(this.openDownloadStream(option.url, option), createWriteStream(option.destination));
            return;
        }
        const chain = option.url.map((u) => () => pipeline(this.openDownloadStream(u, option), createWriteStream(option.destination)));
        let promise = chain.shift()!();
        while (chain.length > 0) {
            const next = chain.shift();
            if (next) { promise = promise.catch(() => next()); }
        }
    }
    /**
     * - If the file is not on the disk, it will return true.
     * - If the checksum is not provided, it will return true if file existed.
     * - If the checksum is provided, it will return true if the file checksum matched.
     */
    async shouldDownload(option: DownloadToOption): Promise<boolean> {
        let missed = await missing(option.destination);
        if (missed) {
            return true;
        }
        if (!option.checksum || option.checksum.hash.length === 0) {
            return false;
        }
        const hash = await checksum(option.destination, option.checksum.algorithm);
        return hash !== option.checksum.hash;
    }
}

/**
 * The default downloader of the library
 */
let downloader: Downloader;
let strategy: DownloadStrategy;

/**
 * Set default downloader of the library
 */
export function setDownloader(newDownloader: Downloader) {
    downloader = newDownloader;
}
export function setDownloadStrategy(newStrategy: DownloadStrategy) {
    strategy = newStrategy;
}
export function getDownloader() { return downloader; }
export function getDownloadStrategy() { return strategy; }

{
    let temp = new DefaultDownloader();
    setDownloader(temp);
    setDownloadStrategy(temp);
}

/**
 * Wrapped task form of the download file task
 */
export function downloadFileTask(option: DownloadToOption, worker: Downloader = downloader, stra: DownloadStrategy = strategy) {
    return async (context: Task.Context) => {
        option.pausable = context.pausealbe;
        option.progress = (c, p, t, u) => context.update(p, t, u);
        await worker.downloadFile(option);
        context.pausealbe(undefined, undefined);
    };
}

/**
 * Wrapped task form of download file if absent task
 */
export function downloadFileIfAbsentTask(option: DownloadToOption, worker: Downloader = downloader, stra: DownloadStrategy = strategy) {
    return async (context: Task.Context) => {
        option.pausable = context.pausealbe;
        option.progress = (c, p, t, u) => context.update(p, t, u);
        if (await stra.shouldDownload(option)) {
            await worker.downloadFile(option);
        }
        context.pausealbe(undefined, undefined);
    };
}

export type JavaExecutor = (args: string[], option?: ExecOptions) => Promise<any>;

export namespace JavaExecutor {
    export function createSimple(javaPath: string, defaultOptions?: ExecOptions): JavaExecutor {
        return function (args, options) {
            return new Promise<void>((resolve, reject) => {
                const process = spawn(javaPath, args, options || defaultOptions);
                process.on("error", (error) => {
                    reject(error);
                });
                process.on("close", (code, signal) => {
                    if (code !== 0) {
                        reject();
                    } else {
                        resolve();
                    }
                });
                process.on("exit", (code, signal) => {
                    if (code !== 0) {
                        reject();
                    } else {
                        resolve();
                    }
                });
                process.stdout.setEncoding("utf-8");
                process.stdout.on("data", (buf) => {
                });
                process.stderr.setEncoding("utf-8");
                process.stderr.on("data", (buf) => {
                    console.error(buf.toString("utf-8"));
                });
            });
        };
    }
}

/**
 * Shared install options
 */
export interface InstallOptions {
    /**
     * When you want to install a version over another one.
     *
     * Like, you want to install liteloader over a forge version.
     * You should fill this with that forge version id.
     */
    inheritsFrom?: string;

    /**
     * Override the newly installed version id.
     *
     * If this is absent, the installed version id will be either generated or provided by installer.
     */
    versionId?: string;
}
