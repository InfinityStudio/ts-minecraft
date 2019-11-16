import { MinecraftFolder } from "@xmcl/util";
import { join, normalize } from "path";
import { LiteLoader } from "./index";

describe("Liteloader", () => {
    const root = normalize(join(__dirname, "..", "..", "temp"));
    const mock = normalize(join(__dirname, "..", "..", "mock"));

    jest.setTimeout(100000000);

    describe("#update", () => {
        test("should be able to fetch liteloader version json", async () => {
            await LiteLoader.VersionMetaList.update({}).then((list) => {
                expect(list).toBeTruthy();
            }).catch((e) => {
                if (e.error === "500: Internal Server Error") {
                    console.warn("Liteloader website is down. Cannot test this.");
                }
            });
        });
    });

    describe("#meta", () => {
        test("should not be able to read other file", async () => {
            await expect(LiteLoader.meta(`${mock}/mods/sample-mod.jar`))
                .rejects
                .toHaveProperty("type", "IllegalInputType");
            await expect(LiteLoader.meta(`${mock}/saves/sample-map.zip`))
                .rejects
                .toHaveProperty("type", "IllegalInputType");
            await expect(LiteLoader.meta(`${mock}/resourcepacks/sample-resourcepack.zip`))
                .rejects
                .toHaveProperty("type", "IllegalInputType");
            await expect(LiteLoader.meta(`${mock}/not-exist.zip`))
                .rejects
                .toBeTruthy();
        });
        test("should be able to parse liteloader info", async () => {
            const metadata = await LiteLoader.meta(`${mock}/mods/sample-mod.litemod`);
            if (!metadata) { throw new Error("Should not happen"); }
            expect(metadata.name).toEqual("ArmorsHUDRevived");
            expect(metadata.mcversion).toEqual("1.12.r2");
            expect(metadata.revision).toEqual(143);
            expect(metadata.author).toEqual("Shadow_Hawk");
        });
    });

    describe("#install", () => {
        test("should be able to install liteloader on 1.12.2", async () => {
            // tslint:disable-next-line:max-line-length
            const meta: LiteLoader.VersionMeta = { url: "http://repo.mumfrey.com/content/repositories/snapshots/", type: "SNAPSHOT", file: "liteloader-1.12.2-SNAPSHOT.jar", version: "1.12.2-SNAPSHOT", md5: "1420785ecbfed5aff4a586c5c9dd97eb", timestamp: "1511880271", mcversion: "1.12.2", tweakClass: "com.mumfrey.liteloader.launch.LiteLoaderTweaker", libraries: [{ name: "net.minecraft:launchwrapper:1.12" }, { name: "org.ow2.asm:asm-all:5.2" }] };
            await LiteLoader.installAndCheck(meta, MinecraftFolder.from(root));
        });
        test("should be able to install liteloader to forge", async () => {
            // tslint:disable-next-line:max-line-length
            const meta: LiteLoader.VersionMeta = { url: "http://repo.mumfrey.com/content/repositories/snapshots/", type: "SNAPSHOT", file: "liteloader-1.12.2-SNAPSHOT.jar", version: "1.12.2-SNAPSHOT", md5: "1420785ecbfed5aff4a586c5c9dd97eb", timestamp: "1511880271", mcversion: "1.12.2", tweakClass: "com.mumfrey.liteloader.launch.LiteLoaderTweaker", libraries: [{ name: "net.minecraft:launchwrapper:1.12" }, { name: "org.ow2.asm:asm-all:5.2" }] };
            await LiteLoader.installAndCheck(meta, MinecraftFolder.from(root), "1.12.2-forge1.12.2-14.23.5.2823");
        });
    });

});
