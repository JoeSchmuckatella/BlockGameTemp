
import * as three from "three";

import * as cbor from "cbor";

// import {Game} from "./game.mts";

const texture_loader = new three.TextureLoader();

/**
 * Gets a texture at the specified path and sets its properties.
 *
 * @param rotation The rotation of the texture. 0 = none, 1 = 90*, etc.
 */
function load_texture(path: string /* , rotation: number = 0 */): three.Texture {
	// Use loadAsync for production? Textures should be loaded on game startup,
	// not when entering world.
	const texture = texture_loader.load(path, () => {}, undefined, undefined);
	texture.colorSpace = three.SRGBColorSpace;
	texture.minFilter = three.NearestFilter;
	texture.magFilter = three.NearestFilter;

	return texture;
}

/**
 * Takes a texture and rotates it.
 * @param angle Should be 90, 180, or 270.
 */
function rotate_texture(texture: three.Texture, angle: number): three.Texture {
	texture.rotation = (Math.PI / 2.0) * (angle / 90.0);
	texture.center.set(0.5, 0.5);
	return texture;
}

// File paths are relative to index.html
// TODO: Implement transparent texture graphics option
const textures = {
	coal_matrix: load_texture("../../../lib/goodvibes/textures/coal_matrix.png"),
	carbuncle_matrix: load_texture("../../../lib/goodvibes/textures/carbuncle_matrix.png"),
	dirt: load_texture("../../../lib/goodvibes/textures/dirt.png"),
	sod_block_top: load_texture("../../../lib/goodvibes/textures/sod_block_top.png"),
	sod_block_side: load_texture("../../../lib/goodvibes/textures/sod_block_side.png"),
	iron_ore: load_texture("../../../lib/goodvibes/textures/iron_ore.png"),
	oak_leaves: load_texture("../../../lib/goodvibes/textures/oak_leaves.png"),
	oak_log_side: load_texture("../../../lib/goodvibes/textures/oak_log.png"),
	oak_log_top: load_texture("../../../lib/goodvibes/textures/oak_log_top.png"),
	oak_boards: rotate_texture(load_texture("../../../lib/goodvibes/textures/oak_boards.png"), 90.0),

	// sand: load_texture("./assets/textures/blocks/sand.png"),
	// snow: load_texture("./assets/textures/blocks/snow.png"),

	stone: load_texture("../../../lib/goodvibes/textures/stone.png"),

	// teak_leaves: load_texture("./assets/textures/blocks/teak_leaves.png"),
	// teak_log_top: load_texture("./assets/textures/blocks/teak_log_top.png"),
	// teak_log_side: load_texture("./assets/textures/blocks/teak_log.png", 0),

	magma: load_texture("../../../lib/goodvibes/textures/magma.png"),
};

/**
 * The template class for all blocks. This should never be used outside of this
 * file apart from for type definitions.
 */
export class Block {

	/**
	 * An integer value representing a block's ID. This number should not exceed
	 * 2^24 - 1 (16,777,215).
	 * @static @readonly
	 */
	static readonly ID: number = 0;

	/**
	 * The block's name as a string. Used for debugging purposes. This will not vary by
	 * locale, unlike item names.
	 * @static @readonly
	 */
	static readonly NAME: string = "Null";

	/**
	 * The block's opacity. This affects lighting calculations. TODO: directionally
	 * dependent opacity?
	 * @static
	 */
	static OPACITY: number = 255;

	/**
	 * Specifies if a block can be replaced by another block when the player tries to
	 * place a block. Ex. air blocks can be replaced by other blocks.
	 * @static
	 */
	static REPLACEABLE: boolean = false;

	/**
	 * Specifies if a block is solid. Used for collision physics.
	 * @static
	 */
	static SOLID: boolean = true;

	/**
	 * Specifies if a block is affected by gravity.
	 * @static
	 */
	// static HAS_GRAVITY: boolean = false;

	/**
	 * An object containing key aliases for block data that is to be saved to a file.
	 * This reduces the number of bytes needed to encode the data. WARNING: ENSURE ALL
	 * VALUES FOR THIS OBJECT ARE UNIQUE WHEN ADDING ENTRIES!!! DO NOT REMOVE KEYS OR
	 * CHANGE THEIR ASSOCIATED VALUES!!!
	 * @protected @static @const
	 */
	protected static BLOCK_KEY_ALIASES = {} as const;

	/**
	 * The CBOR encoder for the block.
	 * @protected @static
	 */
	protected static CBOR_ENCODER: cbor.Encoder;

	/**
	 * The CBOR decoder for the block.
	 * @protected @static
	 */
	protected static CBOR_DECODER: cbor.Decoder;

	/**
	 * The number of blocks of this type within a chunk. Set to 0 by default.
	 */
	count: number;

	/**
	 * The index of this block within a chunk's block table. Set to -1 by default.
	 * Discarded when saving a chunk and manually reset when loading a chunk (in the
	 * chunk loading function, not when decoding the block from CBOR).
	 */
	idx: number;

	/**
	 * Returns the class for accessing static fields conveniently (TypeScript is dumb).
	 * Supposedly faster than instance.constructor.static_property.
	 */ 
	class!: typeof Block;

	/**
	 * The block ID. This must be stored per instance to use the vtable and for saving.
	 */
	ID!: number;

	/**
	 * The block hash. This number must be unique for every variation of every type of
	 * block, with few exceptions that must be handled. The first 3 bytes shall be the
	 * block ID.
	 */
	hash!: bigint;
	
	constructor() {
		// count and idx are set here because they have the same default values
		// for every block.
		this.count = 0;
		this.idx = -1;
	}

	/**
	 * Checks if this block instance is equal to another block instance.
	 */
	// equals(_block: Block): boolean {
	// 	return true;
	// }
	
	/**
	 * Converts the block's data to an object containing the block's ID and any other
	 * data as a byte array. The byte array is empty by default. Used when saving a
	 * chunk.
	 */
	encode(): object {
		return {a: Block.ID};
	}

	/**
	 * Sets the hash value in case a block's state has changed. This will be an empty
	 * function for many classes, since the hash will always be the block ID and will
	 * be set in the constructor.
	 */
	set_hash(): void {}

	/**
	 * Runs relevant code when the block updates.
	 */
	// update() {}

	// on_break() {
	// 	// Update the surrounding blocks.
	// 	Game.get_block()
	// }
}

/**
 * The null block. Used for when there is no other block occupying the space,
 * including air. Has an ID of 0 for future convenience.
 */
export class Null extends Block {
	/**
	 * Used to ensure that TypeScript doesn't allow mixing up blocks. Removed at
	 * compile time or run time.
	 */
	declare readonly __block: "Null";

	static OPACITY: number = 0;

	static decode(_bytes: Uint8Array): Null {
		return new Null();
	}

	class: typeof Null;
	ID: number;
	hash: bigint;

	constructor() {
		super();

		// For some reason setting the fields in the constructor is more
		// efficient.
		this.class = Null;
		this.ID = Null.ID;
		this.hash = BigInt(this.ID);
	}

	encode() {
		return {a: Null.ID};
	}
}

export class Air extends Block {
	declare readonly __block: "Air";

	static readonly ID: number = 1;
	static readonly NAME: string = "Air";
	static OPACITY: number = 0;
	static REPLACEABLE: boolean = true;
	static SOLID: boolean = false;

	static decode(_bytes: Uint8Array): Air {
		return new Air();
	}

	class: typeof Air;
	ID: number;
	hash: bigint;

	constructor() {
		super();
		this.class = Air;
		this.ID = Air.ID;
		this.hash = BigInt(Air.ID);
	}
}

export class Sod extends Block {
	declare readonly __block: "Sod";

	static readonly ID: number = 2;
	static readonly NAME: string = "Sod";

	static material = [
		new three.MeshLambertMaterial(
			{map: rotate_texture(textures.sod_block_side.clone(), 90.0)}  // +X
		),
		new three.MeshLambertMaterial(
			{map: rotate_texture(textures.sod_block_side.clone(), 270.0)} // -X
		),
		new three.MeshLambertMaterial(
			{map: rotate_texture(textures.sod_block_side.clone(), 180.0)} // +Y
		),
		new three.MeshLambertMaterial({map: textures.sod_block_side}),   // -Y
		new three.MeshLambertMaterial({map: textures.sod_block_top}),    // +Z
		new three.MeshLambertMaterial({map: textures.dirt}),             // -Z
	];

	static decode(_bytes: Uint8Array): Sod {
		return new Sod();
	}

	class: typeof Sod;
	ID: number;
	hash: bigint;

	constructor() {
		super();
		this.class = Sod;
		this.ID = Sod.ID;
		this.hash = BigInt(this.ID);
	}
}

export class Dirt extends Block {
	declare readonly __block: "Dirt";

	static readonly ID: number = 3;
	static readonly NAME: string = "Dirt";

	static material: Array<any> = [
		new three.MeshLambertMaterial(
			{map: rotate_texture(textures.dirt.clone(), 90.0)}  // +X
		),
		new three.MeshLambertMaterial(
			{map: rotate_texture(textures.dirt.clone(), 270.0)} // -X
		),
		new three.MeshLambertMaterial(
			{map: rotate_texture(textures.dirt.clone(), 180.0)} // +Y
		),
		new three.MeshLambertMaterial({map: textures.dirt}),   // -Y
		new three.MeshLambertMaterial({map: textures.dirt}),   // +Z
		new three.MeshLambertMaterial({map: textures.dirt}),   // -Z
	];

	static decode(_bytes: Uint8Array): Dirt {
		return new Dirt();
	}

	class: typeof Dirt;
	ID: number;
	hash: bigint;

	constructor() {
		super();
		this.class = Dirt;
		this.ID = Dirt.ID;
		this.hash = BigInt(this.ID);
	}
}

export class Stone extends Block {
	declare readonly __block: "Stone";

	static readonly ID: number = 4;
	static readonly NAME: string = "Stone";

	static material: Array<any> = [
		new three.MeshLambertMaterial(
			{map: rotate_texture(textures.stone.clone(), 90.0)}  // +X
		),
		new three.MeshLambertMaterial(
			{map: rotate_texture(textures.stone.clone(), 270.0)} // -X
		),
		new three.MeshLambertMaterial(
			{map: rotate_texture(textures.stone.clone(), 180.0)} // +Y
		),
		new three.MeshLambertMaterial({map: textures.stone}),   // -Y
		new three.MeshLambertMaterial({map: textures.stone}),   // +Z
		new three.MeshLambertMaterial({map: textures.stone}),   // -Z
	];

	class: typeof Stone;
	ID: number;
	hash: bigint;
	
	constructor() {
		super();
		this.class = Stone;
		this.ID = Stone.ID;
		this.hash = BigInt(this.ID);
	}
}

export class CoalBlock extends Block {
	declare readonly __block: "CoalBlock";

	static readonly ID = 5;
	static readonly NAME = "Coal Block";

	static scale = {x: 20, y: 20, z: 20};
	static scarcity = 0.8; // Noise ranges from 1 through -1. Farther from 1 is more common
	static material: Array<any> = [
		new three.MeshLambertMaterial(
			{map: rotate_texture(textures.coal_matrix.clone(), 90.0)}  // +X
		),
		new three.MeshLambertMaterial(
			{map: rotate_texture(textures.coal_matrix.clone(), 270.0)} // -X
		),
		new three.MeshLambertMaterial(
			{map: rotate_texture(textures.coal_matrix.clone(), 180.0)} // +Y
		),
		new three.MeshLambertMaterial({map: textures.coal_matrix}),   // -Y
		new three.MeshLambertMaterial({map: textures.coal_matrix}),   // +Z
		new three.MeshLambertMaterial({map: textures.coal_matrix}),   // -Z
	];

	class: typeof CoalBlock;
	ID: number;
	hash: bigint;

	constructor() {
		super();
		this.class = CoalBlock;
		this.ID = CoalBlock.ID;
		this.hash = BigInt(this.ID);
	}
}

export class IronOre extends Block {
	declare readonly __block: "IronOre";

	static readonly ID: number = 6;
	static readonly NAME: string = "Iron Ore";

	static scale = {x: 18, y: 18, z: 12};
	static scarcity = 0.9;
	static material = [
		new three.MeshLambertMaterial(
			{map: rotate_texture(textures.iron_ore.clone(), 90.0)}  // +X
		),
		new three.MeshLambertMaterial(
			{map: rotate_texture(textures.iron_ore.clone(), 270.0)} // -X
		),
		new three.MeshLambertMaterial(
			{map: rotate_texture(textures.iron_ore.clone(), 180.0)} // +Y
		),
		new three.MeshLambertMaterial({map: textures.iron_ore}),   // -Y
		new three.MeshLambertMaterial({map: textures.iron_ore}),   // +Z
		new three.MeshLambertMaterial({map: textures.iron_ore}),   // -Z
	];

	class: typeof IronOre;
	ID: number;
	hash: bigint;

	constructor() {
		super();
		this.class = IronOre;
		this.ID = IronOre.ID;
		this.hash = BigInt(this.ID);
	}
}

export class CarbuncleInMatrix extends Block {
	declare readonly __block: "CarbuncleInMatrix";

	static readonly ID: number = 7;
	static readonly NAME: string = "Carbuncle in Matrix";

	static scale = {x: 10, y: 10, z: 10};
	static scarcity = 0.96;
	static material = [
		new three.MeshLambertMaterial(
			{map: rotate_texture(textures.carbuncle_matrix.clone(), 90.0)}  // +X
		),
		new three.MeshLambertMaterial(
			{map: rotate_texture(textures.carbuncle_matrix.clone(), 270.0)} // -X
		),
		new three.MeshLambertMaterial(
			{map: rotate_texture(textures.carbuncle_matrix.clone(), 180.0)} // +Y
		),
		new three.MeshLambertMaterial({map: textures.carbuncle_matrix}),   // -Y
		new three.MeshLambertMaterial({map: textures.carbuncle_matrix}),   // +Z
		new three.MeshLambertMaterial({map: textures.carbuncle_matrix}),   // -Z
	];

	class: typeof CarbuncleInMatrix;
	ID: number;
	hash: bigint;
	
	constructor() {
		super();
		this.class =CarbuncleInMatrix;
		this.ID = CarbuncleInMatrix.ID;
		this.hash = BigInt(this.ID);
	}
}

export class OakLeaves extends Block {
	declare readonly __block: "OakLeaves";

	static readonly ID: number = 8;
	static readonly NAME: string = "Oak Leaves";
	static OPACITY: number = 16;

	static material = [
		new three.MeshLambertMaterial(
			{map: rotate_texture(textures.oak_leaves.clone(), 90.0)}  // +X
		),
		new three.MeshLambertMaterial(
			{map: rotate_texture(textures.oak_leaves.clone(), 270.0)} // -X
		),
		new three.MeshLambertMaterial(
			{map: rotate_texture(textures.oak_leaves.clone(), 180.0)} // +Y
		),
		new three.MeshLambertMaterial({map: textures.oak_leaves}),   // -Y
		new three.MeshLambertMaterial({map: textures.oak_leaves}),   // +Z
		new three.MeshLambertMaterial({map: textures.oak_leaves}),   // -Z
	];

	class: typeof OakLeaves;
	ID: number;
	hash: bigint;

	constructor() {
		super();
		this.class = OakLeaves;
		this.ID = OakLeaves.ID;
		this.hash = BigInt(this.ID);
	}

	/* TODO?
	 static material = [
		new three.MeshLambertMaterial({map: textures.oak_leaves_side_1, transparent: true, side: three.DoubleSide}), // +X
		new three.MeshLambertMaterial({map: textures.oak_leaves_side_3, transparent: true, side: three.DoubleSide}), // -X
		new three.MeshLambertMaterial({map: textures.oak_leaves_side_2, transparent: true, side: three.DoubleSide}), // +Y
		new three.MeshLambertMaterial({map: textures.oak_leaves_side_0, transparent: true, side: three.DoubleSide}), // -Y
		new three.MeshLambertMaterial({map: textures.oak_leaves, transparent: true, side: three.DoubleSide}), // +Z
		new three.MeshLambertMaterial({map: textures.oak_leaves, transparent: true, side: three.DoubleSide}), // -Z
	];
	*/
}

export class OakLog extends Block {
	declare readonly __block: "OakLog";

	static readonly ID: number = 9;
	static readonly NAME: string = "Oak Log";

	static material = [
		new three.MeshLambertMaterial(
			{map: rotate_texture(textures.oak_log_side.clone(), 90.0)}  // +X
		),
		new three.MeshLambertMaterial(
			{map: rotate_texture(textures.oak_log_side.clone(), 270.0)} // -X
		),
		new three.MeshLambertMaterial(
			{map: rotate_texture(textures.oak_log_side.clone(), 180.0)} // +Y
		),
		new three.MeshLambertMaterial({map: textures.oak_log_side}),   // -Y
		new three.MeshLambertMaterial({map: textures.oak_log_top}),    // +Z
		new three.MeshLambertMaterial({map: textures.oak_log_top}),    // -Z
	];

	class: typeof OakLog;
	ID: number;
	hash: bigint;

	constructor() {
		super();
		this.class = OakLog;
		this.ID = OakLog.ID;
		this.hash = BigInt(this.ID);
	}
}

export class OakBoards extends Block {
	declare readonly __block: "OakBoards";

	static readonly ID: number = 10;
	static readonly NAME: string = "Oak Boards";

	static material = [
		new three.MeshLambertMaterial(
			{map: rotate_texture(textures.oak_boards.clone(), 180.0)}  // +X
		),
		new three.MeshLambertMaterial(
			// TODO: WHY DOES THIS ONLY WORK WHEN ROTATED 0*?
			{map: rotate_texture(textures.oak_boards.clone(), 0.0)} // -X
		),
		new three.MeshLambertMaterial(
			{map: rotate_texture(textures.oak_boards.clone(), 270.0)} // +Y
		),
		new three.MeshLambertMaterial(
			{map: rotate_texture(textures.oak_boards.clone(), 90.0)}
		),   // -Y
		new three.MeshLambertMaterial({map: textures.oak_boards}),   // +Z
		new three.MeshLambertMaterial({map: textures.oak_boards}),   // -Z
	];

	class: typeof OakBoards;
	ID: number;
	hash: bigint;

	constructor() {
		super();
		this.class = OakBoards;
		this.ID = OakBoards.ID;
		this.hash = BigInt(this.ID);
	}
}

export class Magma extends Block {
	declare readonly __block: "Magma";

	static readonly ID: number = 11;
	static readonly NAME: string = "Magma";

	class: typeof Magma;
	ID: number;
	hash: bigint;

	constructor() {
		super();
		this.class = Magma;
		this.ID = Magma.ID;
		this.hash = BigInt(this.ID);
	}
}

// export class Sand extends Block {
// 	declare readonly __block: "Sand";

// 	static readonly ID: number = 10;
// 	static readonly NAME: string = "Sand";

// 	static material = [
// 		new three.MeshLambertMaterial(
// 			{map: rotate_texture(textures.sand.clone(), 90.0)}  // +X
// 		),
// 		new three.MeshLambertMaterial(
// 			{map: rotate_texture(textures.sand.clone(), 270.0)} // -X
// 		),
// 		new three.MeshLambertMaterial(
// 			{map: rotate_texture(textures.sand.clone(), 180.0)} // +Y
// 		),
// 		new three.MeshLambertMaterial({map: textures.sand}),   // -Y
// 		new three.MeshLambertMaterial({map: textures.sand}),   // +Z
// 		new three.MeshLambertMaterial({map: textures.sand}),   // -Z
// 	];

// 	class: typeof Sand;
// 	ID: number;
// 	hash: bigint;

// 	constructor() {
// 		super();
// 		this.class = Sand;
// 		this.ID = Sand.ID;
// 		this.hash = BigInt(this.ID);
// 	}
// }

// export class Snow extends Block {
// 	declare readonly __block: "Snow";

// 	static readonly ID: number = 11;
// 	static readonly NAME: string = "Snow";
// 	static OPACITY: number = 128;

// 	static material = [
// 		new three.MeshLambertMaterial(
// 			{map: rotate_texture(textures.snow.clone(), 90.0)}  // +X
// 		),
// 		new three.MeshLambertMaterial(
// 			{map: rotate_texture(textures.snow.clone(), 270.0)} // -X
// 		),
// 		new three.MeshLambertMaterial(
// 			{map: rotate_texture(textures.snow.clone(), 180.0)} // +Y
// 		),
// 		new three.MeshLambertMaterial({map: textures.snow}),   // -Y
// 		new three.MeshLambertMaterial({map: textures.snow}),   // +Z
// 		new three.MeshLambertMaterial({map: textures.snow}),   // -Z
// 	];

// 	class: typeof Snow;
// 	ID: number;
// 	hash: bigint;

// 	constructor() {
// 		super();
// 		this.class = Snow;
// 		this.ID = Snow.ID;
// 		this.hash = BigInt(this.ID);
// 	}
// }

// export class TeakLeaves extends Block {
// 	static ID: number = ;
// 	static NAME: string = "Teak Leaves";
// 	static OPACITY: number = 16;

// 	static material = [
// 		new three.MeshLambertMaterial({map: textures.teak_leaves_side_1}), // +X
// 		new three.MeshLambertMaterial({map: textures.teak_leaves_side_3}), // -X
// 		new three.MeshLambertMaterial({map: textures.teak_leaves_side_2}), // +Y
// 		new three.MeshLambertMaterial({map: textures.teak_leaves_side_0}), // -Y
// 		new three.MeshLambertMaterial({map: textures.teak_leaves}), // +Z
// 		new three.MeshLambertMaterial({map: textures.teak_leaves}), // -Z
// 	];
	
// 	ID: number = TeakLeaves.ID;
// }

// export class TeakLog extends Block {
// 	static ID: number = ;
// 	static NAME: string = "Teak Log";

// 	static material = [
// 		new three.MeshLambertMaterial({map: textures.teak_log_side_1}), // +X
// 		new three.MeshLambertMaterial({map: textures.teak_log_side_3}), // -X
// 		new three.MeshLambertMaterial({map: textures.teak_log_side_2}), // +Y
// 		new three.MeshLambertMaterial({map: textures.teak_log_side_0}), // -Y
// 		new three.MeshLambertMaterial({map: textures.teak_log_top}), // +Z
// 		new three.MeshLambertMaterial({map: textures.teak_log_top}), // -Z
// 	];
	
// 	ID: number = TeakLog.ID;
// }

/**
 * An array of all block types. Allows for accessing a block class using a block
 * ID and iterating over blocks. WARNING: DO NOT DELETE UNTIL Three.js
 * InstancedMeshes HAVE BEEN REPLACED!
 */
export const BLOCKS: (typeof Block)[] = [
	Null,      Air,
	Sod,       Dirt,
	Stone,     CoalBlock,
	IronOre,   CarbuncleInMatrix,
	OakLeaves, OakLog,
	OakBoards, Magma
] as const;

/** Used as a placeholder. */
export const NULL = new Null();

// Add the block type to the CBOR library.
const cbor_block_extension = {
	Class: Block,
	tag: 32_768,
	encode(instance: Block, encode: (value: any) => void) {
		encode({
			a: instance.count,
			b: instance.ID
		});
	},
	decode(data: any): Block {
		const block: Block = new BLOCKS[data.b]();
		block.count = data.a;
		return block;
	}
};
cbor.addExtension(cbor_block_extension);

export const resources = [
	CoalBlock,
	IronOre,
	CarbuncleInMatrix,
] as const;

// TODO: Use Level Of Detail (LOD) objects at extended distances for better
// performance. Calculate average color for texture and render solid color?