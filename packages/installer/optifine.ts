import { MinecraftFolder, MinecraftLocation, Version } from "@xmcl/core";
import { task } from "@xmcl/task";
import { getEntriesRecord, open, readAllEntries, readEntry } from "@xmcl/unzip";
import { ClassReader, ClassVisitor, Opcodes } from "@xmcl/asm";
import { errorFrom, ensureFile, InstallOptions, spawnProcess, writeFile } from "./utils";

export interface BadOptifineJarError {
    error: "BadOptifineJar";
    /**
     * What entry in jar is missing
     */
    entry: string;
}

/**
 * Generate the optifine version json from provided info.
 * @param editionRelease The edition + release with _
 * @param minecraftVersion The minecraft version
 * @param launchWrapperVersion The launch wrapper version
 * @param options The install options
 * @beta Might be changed and don't break the major version
 */
export function generateOptifineVersion(editionRelease: string, minecraftVersion: string, launchWrapperVersion: string, options: InstallOptions = {}): Version {
    let id = options.versionId ?? `${minecraftVersion}-Optifine_${editionRelease}`;
    let inheritsFrom = options.inheritsFrom ?? minecraftVersion;
    let mainClass = "net.minecraft.launchwrapper.Launch";
    return {
        id,
        inheritsFrom,
        arguments: {
            game: ["--tweakClass", "optifine.OptiFineTweaker"],
            jvm: [],
        },
        releaseTime: new Date().toJSON(),
        time: new Date().toJSON(),
        type: "release",
        libraries: [
            { name: `optifine:launchwrapper-of:${launchWrapperVersion}` },
            { name: `optifine:Optifine:${minecraftVersion}_${editionRelease}` }
        ],
        mainClass,
        minimumLauncherVersion: 21,
    };
}

export interface InstallOptifineOptions extends InstallOptions {
    /**
     * The java exectable path. It will use `java` by default.
     */
    java?: string;
}

/**
 * Install optifine by optifine installer
 *
 * @param installer The installer jar file path
 * @param minecraft The minecraft location
 * @param options The option to install
 * @beta Might be changed and don't break the major version
 * @throws {@link BadOptifineJarError}
 */
export function installOptifine(installer: string, minecraft: MinecraftLocation, options?: InstallOptifineOptions) {
    return installOptifineTask(installer, minecraft, options).startAndWait();
}

/**
 * Install optifine by optifine installer task
 *
 * @param installer The installer jar file path
 * @param minecraft The minecraft location
 * @param options The option to install
 * @beta Might be changed and don't break the major version
 * @throws {@link BadOptifineJarError}
 */
export function installOptifineTask(installer: string, minecraft: MinecraftLocation, options: InstallOptifineOptions = {}) {
    return task("installOptifine", async function () {
        let mc = MinecraftFolder.from(minecraft);

        // context.update(0, 100);

        const zip = await open(installer);
        const entries = await readAllEntries(zip);
        const record = getEntriesRecord(entries);
        // context.update(10, 100);

        const entry = record["net/optifine/Config.class"] ?? record["Config.class"];
        if (!entry) {
            throw errorFrom({ error: "BadOptifineJar", entry: "net/optifine/Config.class" });
        }

        const launchWrapperVersionEntry = record["launchwrapper-of.txt"];
        if (!launchWrapperVersionEntry) {
            throw errorFrom({ error: "BadOptifineJar", entry: "launchwrapper-of.txt" });
        }

        const launchWrapperVersion = await readEntry(zip, launchWrapperVersionEntry).then((b) => b.toString());
        // context.update(15, 100);

        const launchWrapperEntry = record[`launchwrapper-of-${launchWrapperVersion}.jar`]
        if (!launchWrapperEntry) {
            throw errorFrom({ error: "BadOptifineJar", entry: `launchwrapper-of-${launchWrapperVersion}.jar` });
        }

        const buf = await readEntry(zip, entry);
        const reader = new ClassReader(buf);
        class OptifineVisitor extends ClassVisitor {
            fields: Record<string, any> = {};
            visitField(access: number, name: string, desc: string, signature: string, value: any) {
                this.fields[name] = value;
                return null;
            }
        }
        const visitor = new OptifineVisitor(Opcodes.ASM5);
        reader.accept(visitor);
        const mcversion: string = visitor.fields.MC_VERSION; // 1.14.4
        const edition: string = visitor.fields.OF_EDITION; // HD_U
        const release: string = visitor.fields.OF_RELEASE; // F5
        const editionRelease = edition + "_" + release;

        const versionJSON = generateOptifineVersion(editionRelease, mcversion, launchWrapperVersion, options);
        const versionJSONPath = mc.getVersionJson(versionJSON.id);

        // context.update(20, 100);
        // write version json
        await this.yield(task("json", async () => {
            await ensureFile(versionJSONPath);
            await writeFile(versionJSONPath, JSON.stringify(versionJSON, null, 4));
        }), /* 20 */);

        // write launch wrapper
        await this.yield(task("library", async () => {
            const wrapperDest = mc.getLibraryByPath(`launchwrapper-of/${launchWrapperVersion}/launchwrapper-of-${launchWrapperVersion}.jar`)
            await ensureFile(wrapperDest);
            await writeFile(wrapperDest, await readEntry(zip, launchWrapperEntry));
        }), /* 20 */);

        // write the optifine
        await this.yield(task("jar", async () => {
            const dest = mc.getLibraryByPath(`optifine/Optifine/${mcversion}_${editionRelease}/Optifine-${mcversion}_${editionRelease}.jar`);
            const mcJar = mc.getVersionJar(mcversion);

            await ensureFile(dest);
            await spawnProcess(options.java ?? "java", ["-cp", installer, "optifine.Patcher", mcJar, installer, dest]);
        }), /* 40 */);

        return versionJSON.id;
    });
}
