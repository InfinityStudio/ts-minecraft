export * from "@xmcl/auth";
export * from "@xmcl/client";
export * from "@xmcl/common";
export * from "@xmcl/fabric";
export * from "@xmcl/forge";
export * from "@xmcl/forge-installer";
export * from "@xmcl/gamesetting";
export * from "@xmcl/installer";
export * from "@xmcl/language";
export * from "@xmcl/launch";
export * from "@xmcl/liteloader";
export * from "@xmcl/mojang";
export * from "@xmcl/nbt";
export { ProfileService } from "@xmcl/profile-service";
export * from "@xmcl/resourcepack";
export * from "@xmcl/task";
export * from "@xmcl/text-component";

import * as Net from "@xmcl/net";
import { GotBodyFn, GotInstance } from "got";
const got: GotInstance<GotBodyFn<string>> = Net.got;

import * as Util from "@xmcl/util"
export { JavaExecutor, Platform, MinecraftFolder, MinecraftLocation } from "@xmcl/util";

export * from "@xmcl/version";
export * from "@xmcl/world";
export { Util, Net, got };
