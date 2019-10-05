# Text-component Module

[![npm version](https://img.shields.io/npm/v/@xmcl/text-component.svg)](https://www.npmjs.com/package/text-component)
[![npm](https://img.shields.io/npm/l/@xmcl/minecraft-launcher-core.svg)](https://github.com/voxelum/minecraft-launcher-core-node/blob/master/LICENSE)
[![Build Status](https://github.com/voxelum/minecraft-launcher-core-node/workflows/Release%20Pre-Check/badge.svg)](https://github.com/voxelum/minecraft-launcher-core-node/workflows/Release%20Pre-Check/badge.svg)

This is a sub-module belong to [minecraft-launcher-core](https://www.npmjs.com/package/@xmcl/minecraft-launcher-core) module. You can still use this individually.

### TextComponent

```ts
    import { TextComponent } from "@xmcl/text-component";
    const fromString: TextComponent = TextComponent.str("from string");
    const formattedString: string;
    const fromFormatted: TextComponent = TextComponent.from(formattedString);
```

Create TextComponent from string OR Minecraft's formatted string, like '§cThis is red'
