
// Lib Imports
import * as cbor from "cbor";
import * as three from "three";
// import {SimplexNoise as SimplexNoise3} from "three/addons/math/SimplexNoise.js";

// Local Imports
import {
	NULL_ARRAY, NULL_INT32_ARRAY,  NULL_MAP,
	NULL_OBJ,   NULL_UINT16_ARRAY, NULL_UINT8_ARRAY
} from "./utils/constants.mjs";
import {SplitMix32F} from "./utils/math/rand/index.mjs";
import * as os from "./utils/os.mjs";
import {Point3, NULL as NULL_POINT_3} from "./utils/math/types/point_3.mjs";
import * as zstd from "./utils/zstd.mjs"
import {BLOCKS, Block, NULL as NULL_BLOCK} from "./blocks.mjs";
import * as blocks from "./blocks.mjs";
import {Game} from "./game.mjs";
import {RenderedObjTypes} from "./rendered_obj_types.mjs";
import {Superchunk, NULL as NULL_SUPERCHUNK} from "./superchunk.mjs";

/** A chunk is 32 blocks x 32 blocks x 32 blocks. 1 block = 19-1/2" */
export const CHUNK_SIDE_LENGTH: number = 32;
/** 2^5 = 32 */
export const CHUNK_SIDE_POWER: number = 5;
/** 0.03125 (1/32). Used for calculating chunk coords from world coords. */
export const ONE_OVER_CHUNK_SIDE_LENGTH: number = 0.03125;
/** 32,768 */
export const CHUNK_VOLUME: number = CHUNK_SIDE_LENGTH**3;
/**
 * The version for chunks created or saved in this version of the game. Is a 32-bit
 * unsigned integer. WARNING: DO NOT CHANGE UNLESS YOU KNOW WHAT YOU'RE DOING!!!
 */
export const VERSION = 0;

const BLOCK_GEOMETRY = new three.BoxGeometry(1, 1, 1, 1, 1, 1);

// Magma texture stuff. TODO: Remove later
const texture_loader = new three.TextureLoader();
// Path is relative to index.html
const magma_texture = texture_loader.load(
	"../../../lib/goodvibes/textures/magma.png",
	() => {},
	undefined,
	undefined
);
magma_texture.colorSpace = three.SRGBColorSpace;
magma_texture.minFilter = three.NearestFilter;
magma_texture.magFilter = three.NearestFilter;
magma_texture.center = new three.Vector2(0.5, 0.5);
magma_texture.wrapS = three.RepeatWrapping;
magma_texture.wrapT = three.RepeatWrapping;
magma_texture.repeat.set(CHUNK_SIDE_LENGTH, CHUNK_SIDE_LENGTH);

/** An enum of biomes. */
// TODO: A region's climate will be determined first, and then the biome.
// Keeping climates separate from biomes will allow multiple biomes to share the
// same climate, allowing for different kinds of forests, grasslands, etc.
const Biomes = {
	FOREST: 0,
	PRARIE: 1
} as const;
type Biome = typeof Biomes[keyof typeof Biomes];

/** An enum of chunk generation stages. */
export const GenStages = {
	UNINITIALIZED: 0,
	INITIALIZED: 10,
	TERRAIN_INITIALIZED: 20,
	TERRAIN_DONE: 50,
	FINISHED: 255
} as const;
export type GenStage = typeof GenStages[keyof typeof GenStages];

// TODO: Rename this. This is block data that is required to render the chunk.
// It doesn't include other "block data" such as block inventories. It should
// include basic block state data since crop blocks at different stages of
// development should be rendered differently in LOD chunks.
type BlockData = {
	/** The block array entry size. */
	a: 1 | 2 | 4 | 8 | 16;
	/** The block array. */
	b: Uint8Array | Uint16Array;
	/** The block table. */
	c: Uint32Array;
	/** Block table counts. TODO: Remove this. */
	d: Int32Array;
};

export class ChunkHeader {
	/** Chunk save version. */
	version: number;
	/** The global chunk coords. */
	coords: Point3;;
	/** The last completed generation stage. */
	last_gen_stage: number;
	/** The block that the chunk consists of if it is uniform. */
	// block: Block;
	/** The block data segment offset. */
	block_data_off: number;
	/** The compressed block data size. */
	compressed_block_data_sz;
	/*
	biome_data_offset: number;
	compressed_biome_data_len: number;
	light_data_off: number;
	compressed_light_data_len: number;
	entity_data_off: number;
	compressed_entity_data_len: number;
	*/

	constructor() {
		this.version = VERSION;
		this.coords = NULL_POINT_3 as Point3;
		this.last_gen_stage = GenStages.UNINITIALIZED;
		this.block_data_off = -1;
		this.compressed_block_data_sz = -1;
	}
};

const cbor_chunk_header_extension = {
	Class: ChunkHeader,
	tag: 32_769,
	encode(instance: ChunkHeader, encode: (value: any) => void) {
		const header = {
			a: instance.version,
			b: {
				// The cbor-x library will encode an object with an iterator as an
				// array, so it's necessary to reconstruct the Point3 as a plain
				// object here.
				x: instance.coords.x,
				y: instance.coords.y,
				z: instance.coords.z
			},
			c: instance.last_gen_stage,
			d: instance.block_data_off,
			e: instance.compressed_block_data_sz,
		};

		encode(header);
	},
	decode(data: any): ChunkHeader {
		const chunk_header = new ChunkHeader();

		switch (data.a) {
			case 0:
				chunk_header.version = data.a;
				chunk_header.coords = new Point3(data.b.x, data.b.y, data.b.z);
				chunk_header.last_gen_stage = data.c;
				chunk_header.block_data_off = data.d;
				chunk_header.compressed_block_data_sz = data.e;
				break;
			default:
				throw new Error("Unknown chunk version.");
		}

		return chunk_header;
	}
};
cbor.addExtension(cbor_chunk_header_extension);

export class Chunk {
	/**
	 * World generation parameters.
	 * @protected @static
	 */
	protected static PARAMS = {
		terrain: {
			scale: 30,
			magnitude: 4,
			offset: 10,
		},
		biomes: {
			scale: 100,
		},
		trees: {
			trunk: {
				min_height: 8,
				max_height: 14,
			},
			canopy: {
				min_radius: 3,
				max_radius: 5,
				density: 0.5,
			},
			frequency: 0.03,
		},
		shrubs: {
			frequency: 0.08
		}
	};

	static TYPE = RenderedObjTypes.CHUNK;

	/**
	 * Takes chunk coords and outputs the respective block_array index.
	 * @protected @static
	 */
	protected static coords_to_block_array_idx(x: number, y: number, z: number): number {
		// ONLY WORKS FOR 32x32x32 CHUNKS
		return (x << 10) | (y << 5) | z;
	}

	/**
	 * A handle to this chunk's superchunk.
	 * @protected
	 */
	superchunk: Superchunk;

	/** @protecetd */
	protected version: number;

	COORDS: Point3;

	/**
	 * The chunk's last completed generation stage.
	 * @protected
	 */
	protected last_gen_stage: number;

	/**
	 * The generation stage that the chunk is currently on.
	 */
	protected _current_gen_stage: number;

	/**
	 * Getter for the current generation stage. Used for tossing out requests to
	 * generate the chunk to a stage below its current stage.
	 */
	get current_gen_stage(): number {
		return this._current_gen_stage;
	}

	/**
	 * The file segment offset that the block table is stored at in the superchunk
	 * file.
	 * @protected
	 */
	protected block_data_offset: number;

	/**
	 * The compressed length of the block table. Required for decompression.
	 * @protected
	 */
	protected compressed_block_data_sz: number;

	/**
	 * The byte size of each entry in the block array. Can be either 1 or 2.
	 * @protected
	 */
	protected block_arr_entry_sz: 1 | 2 | 4 | 8 | 16;

	/**
	 * A table of blocks and their counts currenlty in use by the chunk.
	 * @protected
	 */
	protected block_table: Block[];

	/**
	 * An array of numbers corresponding to indexes in the block table. Automatically
	 * initialzed to 0s per JS spec.
	 * @protected
	 */
	protected block_array: Uint8Array | Uint16Array;

	/**
	 * A map of blocks currently in use by the chunk. The key is a block's hash, and
	 * the value is the block's index in the block array. This is used to quickly check
	 * if a block already exists in the chunk.
	 * @protected
	 */
	protected block_map: Map<bigint, number>;

	/**
	 * An array of available indexes for the block table. This allows indexes to be
	 * reused after blocks are destroyed. The first element being -1 is an optimiztion
	 * and should never be deleted.
	 * @protected
	 */
	protected free_indexes: number[];

	/** @protected */
	protected instance_ids: Int32Array;

	/**
	 * The graphical object for the chunk.
	 */
	graphical_obj: three.Group;

	// When loading the chunk, check the length of biome_table, and use that to
	// determine the type to use for the biome_array. 4-bit numbers should be an
	// option as well, since nearly all chunks will have less than 16 biomes.
	// Each biome "block" should cover a 4x4x4 block part of the chunk.
	// biome_array: Uint8Array | Uint16Array;
	// biome_table: Biome[] = [];

	/**
	 * A set of players that have the chunk loaded. Used for determining if a chunk
	 * can be safely unloaded.
	 */
	// players: WeakSet<Player> = new WeakSet();

	loaded!: boolean;

	protected init_promise: Promise<unknown>;

	protected init_resolver: Function;

	protected gen_queue: Promise<any>;

	protected gen_queue_count: number;

	protected readonly MAX_GEN_QUEUE_LEN: number;

	protected highest_queued_gen_stage: GenStage;

	/**
	 * A weak set containing references to all players. A chunk is no longer loaded by
	 * a player, the player is removed from the set. When a set is empty, the chunk is
	 * unloaded if a specific amount of time has passed.
	 */
	// players: WeakSet<Player>;

	// TODO
	// entities: Entity[];

	/**
	 * @param superchunk A reference to the superchunk that this chunk is a part of.
	 * @param header A reference to a ChunkHeader instance.
	 * @param gen_stage The generation stage up through which the chunk is to be generated.
	 */
	constructor() {
		this.superchunk = NULL_SUPERCHUNK as Superchunk;
		this.graphical_obj = new three.Group();
		this.version = VERSION;
		this.COORDS = NULL_POINT_3 as Point3;
		this.last_gen_stage = GenStages.UNINITIALIZED;
		this._current_gen_stage = GenStages.UNINITIALIZED;
		this.block_data_offset = -1;
		this.compressed_block_data_sz = 0;
		this.block_arr_entry_sz = 8;
		this.block_table = NULL_ARRAY;
		this.block_array = NULL_UINT8_ARRAY as Uint8Array;
		this.block_map = NULL_MAP as Map<bigint, number>;
		this.free_indexes = NULL_ARRAY;
		this.instance_ids = NULL_INT32_ARRAY as Int32Array;
		this.loaded = false;
		const {promise, resolve} = Promise.withResolvers();
		this.init_promise = promise;
		this.init_resolver = resolve;
		this.gen_queue = Promise.resolve();
		this.gen_queue_count = 0;
		this.MAX_GEN_QUEUE_LEN = 100;
		this.highest_queued_gen_stage = GenStages.UNINITIALIZED;

		// this.players = new WeakSet([player]);
	}

	async init(
		// player: Player
		superchunk: Superchunk, hdr: ChunkHeader
	): Promise<void> {
		this.superchunk = superchunk;
		this.version = hdr.version;
		this.COORDS = hdr.coords.clone();
		this.last_gen_stage = hdr.last_gen_stage;
		// this._current_gen_stage
		this.block_data_offset = hdr.block_data_off;
		this.compressed_block_data_sz = hdr.compressed_block_data_sz;
		this.free_indexes = [];
		// this.instance_ids is set in this.generate_meshes().
		
		this._current_gen_stage = GenStages.INITIALIZED

		// await this._generate(gen_stage);

		this.init_resolver();
	}

	/**
	 * Adds a call to the internal generation function to the generation queue. The
	 * internal generation function generates the chunk up through the specified
	 * generation stage.
	 * @async
	 * 
	 * @param gen_stage The generation stage up through which to generate the chunk.
	 */
	async generate(gen_stage: GenStage): Promise<void> {
		await this.init_promise;

		if (this.gen_queue_count >= this.MAX_GEN_QUEUE_LEN) {
			// TODO: Do something here.
			console.warn(
				`Maximum queue count reached for chunk at (${this.COORDS.x}, ${this.COORDS.y}, ${this.COORDS.z}).`
			);
			return;
		}

		if (this.current_gen_stage < GenStages.INITIALIZED) {
			console.error(
				`Attempted to generate chunk at (${this.COORDS.x}, ${this.COORDS.y}, ${this.COORDS.z}) before initialization.`
			);
			return;
		}
		if (this.current_gen_stage >= gen_stage) {return;}
		if (this.highest_queued_gen_stage >= gen_stage) {return;}

		this.gen_queue_count++;
		this.highest_queued_gen_stage = gen_stage;

		const $void = this.gen_queue
			.then(async () => {
				await this._generate(gen_stage);
			})
			.catch(() => {})
			.finally(() => {this.gen_queue_count--;});
		
		this.gen_queue = $void;
		
		await $void;
	}

	/**
	 * Generates the chunk up through the specified generation stage.
	 * @protected @async
	 * 
	 * @param gen_stage The generation stage up through which to generate the chunk.
	 */
	protected async _generate(gen_stage: GenStage): Promise<void> {
		if (this.current_gen_stage >= GenStages.FINISHED) {
			// Abort all other generation functions
			this.gen_queue = Promise.resolve();
			this.gen_queue_count = 0;
			return;
		}

		if (gen_stage <= GenStages.UNINITIALIZED) {return;}

		if (
			(gen_stage >= GenStages.TERRAIN_INITIALIZED) &&
			(this.current_gen_stage < GenStages.TERRAIN_INITIALIZED)
		) {
			if (this.COORDS.z >= -2) {
				this.initialize_terrain();
				this._current_gen_stage = GenStages.TERRAIN_INITIALIZED;
				if (this.last_gen_stage < GenStages.TERRAIN_INITIALIZED) {
					this.last_gen_stage = GenStages.TERRAIN_INITIALIZED;
				}
			} else {
				// Generate magma chunk. Magma chunk is filled with magma blocks,
				// so the chunk can be considered finalized after this runs. The
				// mesh will be generated as well, but this isn't a problem
				// because it's a very simple mesh.
				this.generate_magma_chunk();
				this._current_gen_stage = GenStages.FINISHED;
				this.last_gen_stage = GenStages.FINISHED;
			}
		}

		if ((gen_stage >= GenStages.TERRAIN_DONE) && (this.current_gen_stage < GenStages.TERRAIN_DONE)) {
			if (this.last_gen_stage >= GenStages.TERRAIN_DONE) {
				// Load terrain from file
				const compressed_block_data: Uint8Array = await this.superchunk.read_segments(
					this.block_data_offset, this.compressed_block_data_sz
				);
				const uncompressed_block_data: Uint8Array = zstd.decompress(compressed_block_data);
				const block_data: BlockData = cbor.decode(uncompressed_block_data);

				if (block_data.a <= 8) {
					this.block_array = block_data.b;
				} else if (os.IS_LITTLE_ENDIAN) {
					this.block_array = new Uint16Array(block_data.b.buffer);
				} else {
					const view: DataView = new DataView(block_data.b.buffer);
					this.block_array = new Uint16Array(CHUNK_VOLUME);

					for (let i: number = 0; i < CHUNK_VOLUME; i++) {
						this.block_array[i] = view.getUint16(i << 1, false);
					}
				}

				// Recreate the block table.
				this.block_table = [];
				for (let i: number = 0; i < block_data.c.length; i++) {
					const block = new BLOCKS[block_data.c[i]]();
					block.idx = i;
					block.count = block_data.d[i];
					this.block_table.push(block);
				}

				if (this.block_map === NULL_MAP) {
					this.block_map = new Map();
				}

				// Recreate the block map with new hashes in case the hashes changed
				// after an update. Iterate backwards so the last free indexes are at
				// the beginning of the table.
				for (let i = this.block_table.length - 1; i >= 0; i--) {
					const block = this.block_table[i];
					if (block !== NULL_BLOCK) {
						this.block_map.set(block.hash, i);
					} else {
						this.free_indexes.push(i);
					}
				}
			} else {
				// Generate new terrain

				this.generate_terrain();
				this.generate_resources();
				this.generate_vegetation();

				if (true) {
					// Fill the free index. Iterate backwards so that the last free
					// indexes are at the beginning of the table.
					for (let i = this.block_table.length - 1; i >= 0; i--) {
						if (this.block_table[i] === NULL_BLOCK) {
							this.free_indexes.push(i);
						}
					}
				}

				this.last_gen_stage = GenStages.TERRAIN_DONE;
			}

			this._current_gen_stage = GenStages.TERRAIN_DONE;
		}

		if ((gen_stage >= GenStages.FINISHED) && (this.current_gen_stage < GenStages.FINISHED)) {
			await this.generate_meshes();
			this._current_gen_stage = GenStages.FINISHED;
			this.last_gen_stage = GenStages.FINISHED;
			this.loaded = true;
		}
	}

	/**
	 * Initializes the chunk and sets the current generation stage to INITIALIZED.
	 * @protected
	 * 
	 * @param partial Indicates if the chunk should be partially initialized. This is done when the
	                  chunk's terrain has already been generated and should be read from the
	                  superchunk file.
	 */
	protected initialize_terrain() {
		if (this.last_gen_stage > GenStages.TERRAIN_INITIALIZED) {
			// If the last generation stage is greater than GenStages.INITIALIZED,
			// assume that the terrain is fully generated and the data is saved in
			// the superchunk file and will needed to be loaded from there.
			this.block_map = new Map();
			return;
		}

		let block: blocks.Air = new blocks.Air();
		block.count = CHUNK_VOLUME;
		block.idx = 0;
		this.block_table = [block];

		this.block_array = new Uint8Array(CHUNK_VOLUME);

		this.block_map = new Map();
		this.block_map.set(block.hash, block.idx);
	}

	/**
	 * Generate magma chunk.
	 * @protected
	 */
	protected generate_magma_chunk() {
		const block: blocks.Magma = new blocks.Magma();
		block.count = CHUNK_VOLUME;
		block.idx = 0;
		this.block_table = [block];

		this.block_array = new Uint8Array(CHUNK_VOLUME);

		this.block_map = new Map();
		this.block_map.set(block.hash, 0);

		// TODO: Planar mesh is temporary optimization. Use magma blocks later.
		const material = new three.MeshLambertMaterial({map: magma_texture});

		const magma_mesh = new three.Mesh(new three.PlaneGeometry(), material);
		// Subtract 0.001 to prevent z-fighting with transparent blocks:
		magma_mesh.position.set(
			CHUNK_SIDE_LENGTH / 2.0, CHUNK_SIDE_LENGTH / 2.0, CHUNK_SIDE_LENGTH - 0.001
		);
		magma_mesh.scale.set(CHUNK_SIDE_LENGTH, CHUNK_SIDE_LENGTH, 1);
		magma_mesh.layers.set(1);

		this.graphical_obj.add(magma_mesh as any);
		this.graphical_obj.position.set(
			this.COORDS.x * 32.0,
			this.COORDS.y * 32.0,
			this.COORDS.z * 32.0
		);
		Game.world.graphical_obj.add(this.graphical_obj);
	}

	/**
	 * Get the biome at the local chunk coordinates (x, y). TODO: Store biome data in
	 * chunk.
	 * @protected
	 */
	protected get_biome(x: number, y: number): number {
		let noise = Game.BIOME_NOISE.noise_2d(
			((this.COORDS.x * 32.0) + x) / Chunk.PARAMS.biomes.scale,
			((this.COORDS.y * 32.0) + y) / Chunk.PARAMS.biomes.scale
		);

		return (noise < 0) ? Biomes.FOREST : Biomes.PRARIE;
	}

	/**
	 * Internal function for initializing blocks to add to the chunk inside a chunk
	 * generation function. Adds the blocks in argument "blocks" to this.block_table.
	 * Copies the idx fields from this.block_table to the corresponding block in
	 * blocks. Should be called at the beginning of the function. this._finalize_blocks
	 * must be called at the end of the chunk generation function for cleanup.
	 * @protected
	 * 
	 * @param blocks A table with the same format as this.blocks_table. Only blocks that will be added
	 *               are required. Blocks that can be replaced must also be added, or this.block_table can be
	 *               passed to this._finalize_blocks instead. All count fields should be initialized to 0.
	 *               No element should be null.
	 */
	protected _initialize_blocks(blocks: Block[]): void {
		for (const block of blocks) {
			let block_table_idx: number | undefined = this.block_map.get(block.hash);
			if (block_table_idx === undefined) {
				block_table_idx = this.free_indexes[this.free_indexes.length - 1];
				if (block_table_idx === undefined) {
					block.idx = this.block_table.length;
					this.block_table.push(block);
				} else {
					 // TODO: Get rid of this line? Should be 0 by default.
					block.count = 0;
					block.idx = block_table_idx;
					this.block_table[block_table_idx] = block;
				}
			} else {
				block.idx = block_table_idx;
			}
		}
	}

	/**
	 * Internal function for setting blocks in a chunk generation function. Should only
	 * be called for blocks that were added with this._add_block. this._finalize_blocks
	 * must be called at the end of the chunk generation function for cleanup.
	 * @protected
	 * 
	 * @param arr_idx The block_array index where the swap is to occur.
	 * @param new_table_idx The block_table index of the new block.
	 */
	protected _set_block(arr_idx: number, new_table_idx: number): void {
		this.block_table[this.block_array[arr_idx]].count--;
		this.block_array[arr_idx] = new_table_idx;
		this.block_table[new_table_idx].count++;
	}

	/**
	 * Internal finalization function for block changes inside a chunk generation
	 * function. Removes blocks that no longer exist and adds new blocks to
	 * this.block_map. Should be called at the end of a chunk generation function if
	 * this._add_blocks was called at the beginning of the function.
	 * @protected
	 * 
	 * @param blocks This should be the same block table that was passed to this._initialize_blocks, or
	 *               this.block_table.
	 */
	protected _finalize_blocks(blocks: Block[]): void {
		if (blocks === this.block_table) {
			// Iterate over the entire block table and remove unused blocks
			for (let i: number = blocks.length - 1; i >= 0; i--) {
				const block = blocks[i];
				if (block.count <= 0) {
					// Just delete the entry if it's the last one in the table.
					if (i === (blocks.length - 1)) {
						blocks.length--;
					} else {
						blocks[i] = NULL_BLOCK;
					}
					this.block_map.delete(block.hash);
				} else if (block !== NULL_BLOCK) {
					this.block_map.set(block.hash, i);
				}
			}
		} else {
			// Only check blocks in this.block_table that are in the provided
			// blocks array.
			for (const block of blocks) {
				const idx = block.idx;
				let entry = this.block_table[idx];
				if ((entry === NULL_BLOCK) || (entry.count <= 0)) {
					// Just delete the entry if it's the last one in the table.
					if (idx === (blocks.length - 1)) {
						this.block_table.length--;
					} else {
						this.block_table[idx] = NULL_BLOCK;
					}
					this.block_map.delete(entry.hash);
				} else if (entry !== NULL_OBJ) {
					this.block_map.set(entry.hash, idx);
				}
			}
		}
	}
	
	/**
	 * Returns the block at the specified coordinates.
	 * @protected
	 */
	protected _get_block(x: number, y: number, z: number): Block {
		return this.block_table[this.block_array[Chunk.coords_to_block_array_idx(x, y, z)]]!;
	}

	/** Sets the block at (x, y, z). */
	set_block(x: number, y: number, z: number, block: Block): void {
		if (this.current_gen_stage < GenStages.FINISHED) {return;}

		const block_arr_idx: number = Chunk.coords_to_block_array_idx(x, y, z);

		// Remove current block
		let block_table_idx: number | undefined = this.block_array[block_arr_idx];
		let block_table_entry = this.block_table[block_table_idx]!;

		// TODO: Check for null? Should never happen...
		block_table_entry.count--;
		if (block_table_entry.count <= 0) {
			this.block_map.delete(block_table_entry.hash);
			if (block_table_idx === (this.block_table.length - 1)) {
				this.block_table.length--;
			} else {
				this.block_table[block_table_idx] = NULL_BLOCK;
				this.free_indexes.push(block_table_idx);
			}
		}

		// Add new block
		block_table_idx = this.block_map.get(block.hash);
		if (block_table_idx === undefined) {
			block_table_idx = this.free_indexes[this.free_indexes.length - 1];
			block.count = 0;
			if (block_table_idx === undefined) {
				// .push() returns the new length of the array.
				block_table_idx = this.block_table.push(block) - 1;
			} else {
				this.block_table[block_table_idx] = block;
				this.free_indexes.length--;
			}

			block.idx = block_table_idx;
			this.block_map.set(block.hash, block_table_idx);
		}

		this.block_table[block_table_idx]!.count++;
		this.block_array[block_arr_idx] = block_table_idx;
	}

	/**
	 * Generates the terrain.
	 * @protected
	 */
	protected generate_terrain() {
		// Create block table
		const new_blocks: Block[] = [
			new blocks.Air(),
			new blocks.Sod(),
			new blocks.Dirt(),
			new blocks.Stone(),
		];

		this._initialize_blocks(new_blocks);

		const air:   Block = new_blocks[0];
		const sod:   Block = new_blocks[1];
		const dirt:  Block = new_blocks[2];
		const stone: Block = new_blocks[3];

		// Generate terrain
		for (var x = 0; x < CHUNK_SIDE_LENGTH; x++) {
			for (var y = 0; y < CHUNK_SIDE_LENGTH; y++) {
				// Compute noise value at x-y location
				const value = Game.TERRAIN_NOISE.noise_2d(
					((this.COORDS.x * 32.0) + x) / Chunk.PARAMS.terrain.scale,
					((this.COORDS.y * 32.0) + y) / Chunk.PARAMS.terrain.scale
				);

				// Scale noise based on magnitude and offset
				const scaled_noise = Chunk.PARAMS.terrain.offset + Chunk.PARAMS.terrain.magnitude * value;

				// Compute height of terrain at this x-y location
				let height = Math.floor(scaled_noise);

				// Fill in all blocks at or below terrain height
				for (var z = 0; z < CHUNK_SIDE_LENGTH; z++) {
					const block_arr_idx: number = Chunk.coords_to_block_array_idx(x, y, z);
					const current_block = this.block_table[this.block_array[block_arr_idx]]!;
					const world_z = z + (CHUNK_SIDE_LENGTH * this.COORDS.z);

					if (world_z > height) {
						this._set_block(block_arr_idx, air.idx);
					} else if ((world_z < height) && (world_z > (height - 4))) {
						this._set_block(block_arr_idx, dirt.idx);
					} else if ((world_z <= (height - 4)) && (current_block.ID === blocks.Air.ID)) {
						this._set_block(block_arr_idx, stone.idx);
					} else if (world_z === height) {
						this._set_block(block_arr_idx, sod.idx);
					}
				}
			}
		}

		this._finalize_blocks(this.block_table);
	}

	/**
	 * Generates resources (coal, iron, etc.).
	 * @protected
	 */
	protected generate_resources() {
		// Only stone blocks are currently replaced by this function. If there are
		// no stone blocks, don't run the function.
		const stone_block_table_idx: number | undefined = this.block_map.get(new blocks.Stone().hash);
		if (!stone_block_table_idx) {return;}

		// Don't add stone here because of above check.
		const resources = [
			new blocks.CoalBlock(),
			new blocks.IronOre(),
			new blocks.CarbuncleInMatrix()
		];

		this._initialize_blocks(resources);

		for (const resource of resources) {
			// Add resources to the chunk.
			for (let x: number = 0; x < CHUNK_SIDE_LENGTH; x++) {
				for (let y: number = 0; y < CHUNK_SIDE_LENGTH; y++) {
					for (let z: number = 0; z < CHUNK_SIDE_LENGTH; z++) {
						const block_arr_idx: number = Chunk.coords_to_block_array_idx(x, y, z);
						const world_z: number = z + (CHUNK_SIDE_LENGTH * this.COORDS.z);
						if ((resource.ID === blocks.CarbuncleInMatrix.ID) && (world_z > -20)) {
							continue;
						}
						const current_block_table_entry = 
								this.block_table[this.block_array[block_arr_idx]];
						if (current_block_table_entry.ID !== blocks.Stone.ID) {
							continue;
						}
						const resource_class = resource.class;
						const value = Game.RESOURCE_NOISE.noise_3d(
							((this.COORDS.x << 5) + x) / resource_class.scale.x,
							((this.COORDS.y << 5) + y) / resource_class.scale.y,
							((this.COORDS.z << 5) + z) / resource_class.scale.z
						);

						if (value > resource_class.scarcity) {
							// Only stone can be replaced right now, so don't check for
							// anything else.
							this._set_block(block_arr_idx, resource.idx);
						}
					}
				}
			}
		}

		this._finalize_blocks(this.block_table);
	}

	/**
	 * Populates chunk with trees and bushes (if applicable).
	 * @protected
	 */
	protected generate_vegetation() {
		/** The height difference between the shortest tree trunk and the tallest. */
		const H_DIFF: number =
				Chunk.PARAMS.trees.trunk.max_height - Chunk.PARAMS.trees.trunk.min_height;
		/** The radius difference between the smallest canopy and the biggest. */
		const R_DIFF: number =
				Chunk.PARAMS.trees.canopy.max_radius - Chunk.PARAMS.trees.canopy.min_radius;

		const tree_blocks: Block[] = [
			new blocks.OakLog(),
			new blocks.OakLeaves(),
			new blocks.Dirt(),
			new blocks.Air(),
			new blocks.Sod(),
		];

		this._initialize_blocks(tree_blocks);

		const oak_log: Block = tree_blocks[0];
		const oak_leaves: Block = tree_blocks[1];
		const dirt: Block = tree_blocks[2];

		const seed: number = this.COORDS.x ^ this.COORDS.y ^ this.COORDS.z ^ Game.SEED_LOWER_HALF;
		const prng: SplitMix32F = new SplitMix32F(seed);

		const arr: Uint8Array = new Uint8Array(CHUNK_SIDE_LENGTH**2);
		let x: number = 0;
		let y: number = 0;
		for (let i: number = 0; i < arr.length; i++) {
			y = i % CHUNK_SIDE_LENGTH;
			x = i >> 5;

			const biome: number = this.get_biome(x, y);
			if (biome !== Biomes.FOREST) {continue;}

			const rand: number = prng.random();
			if (rand > Chunk.PARAMS.shrubs.frequency) {continue;}

			// Search for sod block, which indicates top of terrain.
			for (let z: number = 0; z < CHUNK_SIDE_LENGTH; z++) {
				let block_arr_idx: number = Chunk.coords_to_block_array_idx(x, y, z);
				const block: Block = this._get_block(x, y, z);

				if ((block === NULL_BLOCK) || (block.ID !== blocks.Sod.ID)) {
					continue;
				}

				// Generate shrub
				if (rand > Chunk.PARAMS.trees.frequency) {
					this._set_block(++block_arr_idx, oak_leaves.idx);
					break;
				}

				// Generate tree. Trees generate away from chunk edges to prevent
				// canopies from being cut off.
				const r: number = Math.round(
					Chunk.PARAMS.trees.canopy.min_radius + (R_DIFF * prng.random())
				);
				if (
					(x > r) && (x < (CHUNK_SIDE_LENGTH - r)) &&
					(y > r) && (y < (CHUNK_SIDE_LENGTH - r)) &&
					(arr[i] === 0)
				) {
					// This code is dependent on the tree canopy having a minimum
					// radius of 3.
					let idx: number = i;
					arr[idx + 1] = 1;
					idx = (x << 5) + (y - 1);
					arr[idx++] = 1; arr[idx++] = 1; arr[idx] = 1;

					// Set block below tree trunk to dirt
					this._set_block(block_arr_idx++, dirt.idx);
					
					const h: number = Math.round(
						Chunk.PARAMS.trees.trunk.min_height + (H_DIFF * prng.random())
					);
					const trunk_start_idx: number = block_arr_idx;
					for (block_arr_idx; block_arr_idx <= trunk_start_idx + h; block_arr_idx++) {
						this._set_block(block_arr_idx, oak_log.idx);
					}

					// Generate canopy centered on top of tree
					const center_x: number = x;
					const center_y: number = y;
					const center_z: number = z + h;

					for (let x: number = -r; x <= r; x++) {
						for (let y: number = -r; y <= r; y++) {
							for (let z: number = -r; z <= r; z++) {
								const rand: number = prng.random();
								// Ensure that block is within canopy radius
								if (x**2 + y**2 + z**2 >= r**2) {continue;}

								const block_idx: number = Chunk.coords_to_block_array_idx(
									center_x + x, center_y + y, center_z + z
								);
								const block: Block = this.block_table[this.block_array[block_idx]]!;
								// Ensure that existing blocks are not overwritten
								if (block.ID === blocks.Air.ID) {
									if (rand < Chunk.PARAMS.trees.canopy.density) {
										this._set_block(block_idx, oak_leaves.idx);
									}
								}
							}
						}
					}
					break;
				}
			}
		}

		// for (let x: number = 0; x < CHUNK_SIDE_LENGTH; x++) {
		// 	for (let y: number = 0; y < CHUNK_SIDE_LENGTH; y++) {

		// 		const biome: number = this.get_biome(x, y);
		// 		if (biome !== Biomes.FOREST) {continue;}

		// 		const rand: number = prng.random();
		// 		if (rand > Chunk.PARAMS.shrubs.frequency) {continue;}

		// 		// Search for sod block, which indicates top of terrain
		// 		for (let z: number = 0; z < CHUNK_SIDE_LENGTH; z++) {
		// 			let block_arr_idx: number = Chunk.coords_to_block_array_idx(x, y, z);
		// 			const block: Block = this.get_block(x, y, z);

		// 			if ((block === NULL_BLOCK) || (block.ID !== blocks.Sod.ID)) {
		// 				continue;
		// 			}

		// 			// Generate shrub
		// 			if (rand > Chunk.PARAMS.trees.frequency) {
		// 				this._set_block(++block_arr_idx, oak_leaves.idx);
		// 				break;
		// 			}

		// 			// Generate tree. Trees generate away from chunk edges to prevent
		// 			// canopies from being cut off.
		// 			const r: number = Math.round(
		// 				Chunk.PARAMS.trees.canopy.min_radius + (R_DIFF * prng.random())
		// 			);
		// 			if (
		// 				(x > r) && (x < (CHUNK_SIDE_LENGTH - r)) &&
		// 				(y > r) && (y < (CHUNK_SIDE_LENGTH - r))
		// 			) {
		// 				// Increment the y value to minimize trees generating right
		// 				// next to eachother:
		// 				y++;

		// 				// Set block below tree trunk to dirt
		// 				this._set_block(block_arr_idx++, dirt.idx);
						
		// 				const h: number = Math.round(
		// 					Chunk.PARAMS.trees.trunk.min_height + (H_DIFF * prng.random())
		// 				);
		// 				const trunk_start_idx: number = block_arr_idx;
		// 				for (block_arr_idx; block_arr_idx <= trunk_start_idx + h; block_arr_idx++) {
		// 					this._set_block(block_arr_idx, oak_log.idx);
		// 				}

		// 				// Generate canopy centered on top of tree
		// 				const center_x: number = x;
		// 				const center_y: number = y;
		// 				const center_z: number = z + h;

		// 				for (let x: number = -r; x <= r; x++) {
		// 					for (let y: number = -r; y <= r; y++) {
		// 						for (let z: number = -r; z <= r; z++) {
		// 							const rand: number = prng.random();
		// 							// Ensure that block is within canopy radius
		// 							if (x**2 + y**2 + z**2 >= r**2) {continue;}

		// 							const block_idx: number = Chunk.coords_to_block_array_idx(
		// 								center_x + x, center_y + y, center_z + z
		// 							);
		// 							const block: Block = this.block_table[this.block_array[block_idx]]!;
		// 							// Ensure that existing blocks are not overwritten
		// 							if (block.ID === blocks.Air.ID) {
		// 								if (rand < Chunk.PARAMS.trees.canopy.density) {
		// 									this._set_block(block_idx, oak_leaves.idx);
		// 								}
		// 							}
		// 						}
		// 					}
		// 				}
		// 				break;
		// 			}
		// 		}
		// 	}
		// }

		this._finalize_blocks(tree_blocks);
	}

	/**
	 * Generates the graphical meshes for the chunk.
	 * @protected @async
	 */
	protected async generate_meshes() {
		this.graphical_obj.clear();
		this.instance_ids = new Int32Array(CHUNK_VOLUME).fill(-1);

		const MAX_COUNT = CHUNK_VOLUME;

		// Lookup table where the key is the block ID
		const meshes: Record<number, three.InstancedMesh> = {};

		for (let i = 0; i < BLOCKS.length; i++) {
			const material = (BLOCKS[i] as any).material;
			if (material) {
				const mesh = new three.InstancedMesh(
					BLOCK_GEOMETRY, material, MAX_COUNT
				);

				// Optimization. This should only be done to objects that do not
				// move.
				mesh.matrixAutoUpdate = false;

				mesh.name = String(BLOCKS[i].ID);
				mesh.count = 0;
				mesh.castShadow = true;
				mesh.receiveShadow = true;

				meshes[BLOCKS[i].ID] = mesh;
			}
		}

		// Get chunks around this chunk
		const chunks: Chunk[] = new Array(6);
		const {x, y, z} = this.COORDS;
		const chunk_coords: number[] = [
			x,     y,     z + 1, x,     y,     z - 1,
			x - 1, y,     z,     x + 1, y,     z,
			x,     y + 1, z,     x,     y - 1, z
		];

		for (let i: number = 0; i < chunks.length; i++) {
			const x: number = chunk_coords[i * 3];
			const y: number = chunk_coords[(i * 3) + 1];
			const z: number = chunk_coords[(i * 3) + 2];

			let chunk: Chunk | undefined = Game.world.get_chunk(x, y, z);
			if (!chunk) {
				chunk = await Game.world.load_chunk(x, y, z, GenStages.TERRAIN_DONE);
				if (!chunk) {
					throw new Error(`Could not load chunk at (${x}, ${y}, ${z}).`);
				}
			} else if (chunk.current_gen_stage < GenStages.TERRAIN_DONE) {
				await chunk.generate(GenStages.TERRAIN_DONE);
			}
			chunks[i] = chunk;
		}

		const chunk_above:  Chunk = chunks[0];
		const chunk_below:  Chunk = chunks[1];
		const chunk_left:   Chunk = chunks[2];
		const chunk_right:  Chunk = chunks[3];
		const chunk_ahead:  Chunk = chunks[4];
		const chunk_behind: Chunk = chunks[5];

		/**
		 * A function mimicking the this.is_block_obscured function, but accounting for the
		 * opacities of blocks in adjacent chunks.
		 */
		const is_block_obscured: Function = (x: number, y: number, z: number) => {
			let above: typeof Block;
			if (this.is_in_chunk(x, y, z + 1)) {
				above = this._get_block(x, y, z + 1).class;
			} else {
				above = chunk_above._get_block(x, y, 0).class;
			}

			let below: typeof Block;
			if (this.is_in_chunk(x, y, z - 1)) {
				below = this._get_block(x, y, z - 1).class;
			} else {
				below = chunk_below._get_block(x, y, 31).class;
			}

			let left: typeof Block;
			if (this.is_in_chunk(x - 1, y, z)) {
				left = this._get_block(x - 1, y, z).class;
			} else {
				left = chunk_left._get_block(31, y, z).class;
			}

			let right: typeof Block;
			if (this.is_in_chunk(x + 1, y, z)) {
				right = this._get_block(x + 1, y, z).class;
			} else {
				right = chunk_right._get_block(0, y, z).class;
			}

			let ahead: typeof Block;
			if (this.is_in_chunk(x, y + 1, z)) {
				ahead = this._get_block(x, y + 1, z).class;
			} else {
				ahead = chunk_ahead._get_block(x, 0, z).class;
			}

			let behind: typeof Block;
			if (this.is_in_chunk(x, y - 1, z)) {
				behind = this._get_block(x, y - 1, z).class;
			} else {
				behind = chunk_behind._get_block(x, 31, z).class;
			}

			return (above.OPACITY >= 255) && (below.OPACITY  >= 255) &&
			       (right.OPACITY >= 255) && (left.OPACITY   >= 255) &&
			       (ahead.OPACITY >= 255) && (behind.OPACITY >= 255);
		}

		const matrix = new three.Matrix4();
		for (let x = 0; x < CHUNK_SIDE_LENGTH; x++) {
			for (let y = 0; y < CHUNK_SIDE_LENGTH; y++){
				for (let z = 0; z < CHUNK_SIDE_LENGTH; z++) {
					const block: Block = this._get_block(x, y, z);
					
					if ((block.class.OPACITY <= 0) || (!(block.class as any).material)) {
						continue;
					}
					
					const mesh = meshes[block.ID];
					const instance_id = mesh.count;
					
					if (!is_block_obscured(x, y, z)) {
						// Align block faces with whole number coordinates. This
						// should help with optimizations later.
						matrix.setPosition(x + 0.5, y + 0.5, z + 0.5);
						mesh.setMatrixAt(instance_id, matrix);
						this.instance_ids[Chunk.coords_to_block_array_idx(x, y, z)] = instance_id;
						mesh.count++;
					}
				}
			}
		}

		this.graphical_obj.add(...Object.values(meshes));
		this.graphical_obj.position.set(
			this.COORDS.x * 32.0,
			this.COORDS.y * 32.0,
			this.COORDS.z * 32.0
		);
		Game.world.graphical_obj.add(this.graphical_obj);
	}

	/**
	 * Gets the block at (x, y, z). Returns the Null block if the chunk isn't fully
	 * loaded.
	 * 
	 * @param x The block's local X-coordinate.
	 * @param y The block's local Y-coordinate.
	 * @param z The block's local Z-coordinate.
	 */
	get_block(x: number, y: number, z: number): Block {
		if (!this.is_in_chunk(x, y, z)) {
			throw new Error("ERROR: Attempted to access block outside of chunk.");
		} else if (this.current_gen_stage < GenStages.FINISHED) {
			return NULL_BLOCK;
		}
		return this.block_table[
			this.block_array[Chunk.coords_to_block_array_idx(x, y, z)]
		]!;
	}

	/**
	 * Replaces the block at (x, y, z) with the specified block.
	 * 
	 * @param x The block's local X-coordinate.
	 * @param y The block's local Y-coordinate.
	 * @param z The block's local Z-coordinate.
	 */
	add_block(x: number, y: number, z: number, block: Block): void {
		const old_block = this.get_block(x, y, z);

		if (old_block === NULL_BLOCK) {return;}

		if (old_block.class.REPLACEABLE) {
			this.set_block(x, y, z, block);
			this.add_block_instance(x, y, z);
		}
	}

	/**
	 * Removes block at (x, y, z) and sets it to air.
	 * 
	 * @param x The block's local X-coordinate.
	 * @param y The block's local Y-coordinate.
	 * @param z The block's local Z-coordinate.
	 */
	remove_block(x: number, y: number, z: number): void {
		const block = this.get_block(x, y, z);

		if (block === NULL_BLOCK) {return;}

		if ((block.ID !== blocks.Air.ID) && (block.ID !== blocks.Magma.ID)) {
			this.delete_block_instance(x, y, z);
			this.set_block(x, y, z, new blocks.Air());
		}
	}

	/**
	 * Removes the mesh instance associated with block by swapping it with the
	 * last instance and decrementing the instance count.
	 * 
	 * @param x The block's local X-coordinate.
	 * @param y The block's local Y-coordinate.
	 * @param z The block's local Z-coordinate.
	 */
	delete_block_instance(x: number, y: number, z: number): void {
		if (!this.is_in_chunk(x, y, z)) {
			console.error("Attempted to delete a block instance outside of a chunk.");
			return;
		} else if (this.current_gen_stage < GenStages.FINISHED) {
			console.warn("Attempted to delete a block instance in a chunk that is not fully loaded.");
			return;
		}

		const block_idx = Chunk.coords_to_block_array_idx(x, y, z);
		const block = this.block_table[this.block_array[block_idx]]!;

		if (block === NULL_BLOCK) {
			console.error("Attempted to delete Null block instance.");
			return;
		}

		// Get the InstancedMesh object (contains array of meshes)
		const mesh: three.InstancedMesh | undefined = this.graphical_obj.children.find(
			(instanced_mesh) => {return Number(instanced_mesh.name) === block.ID;}
		) as three.InstancedMesh;
		if (mesh === undefined) {
			console.error("Attempted to delete undefined block mesh.");
			return;
		}

		// Get instance ID of block
		const instance_id: number = this.instance_ids[block_idx];
		if (instance_id < 0) {
			console.error("Mesh instance ID is less than 0.");
			return;
		}

		// Can't move an instance directly, so swap it with the last instance and
		// reduce the instance count by 1

		// Swap the transformation matrix of the block in the last position with
		// the block that will be removed

		// Get the transformation matrix of the last mesh in the InstancedMesh
		// array
		const lastMatrix = new three.Matrix4();
		mesh.getMatrixAt(mesh.count - 1, lastMatrix);

		// Set the instance ID of the block in the last position to the instance
		// ID of the target block
		const v = new three.Vector3();
		// v.applyMatrix4(lastMatrix);

		v.setFromMatrixPosition(lastMatrix);
		// Sets the instance ID of the last block in the mesh array to the current
		// block's instance ID.
		this.instance_ids[
			Chunk.coords_to_block_array_idx(
				Math.floor(v.x),
				Math.floor(v.y),
				Math.floor(v.z))
		] = instance_id;

		// Swap the transformation matrices
		// Sets the matrix of the mesh at index instanceId to lastMatrix
		mesh.setMatrixAt(instance_id, lastMatrix);

		// This effectively removes the last instance from the scene
		mesh.count--;

		// Notify the instanced mesh that the instance matrix was updated and
		// recompute the bounding sphere so raycasting works.
		mesh.instanceMatrix.needsUpdate = true;
		mesh.computeBoundingSphere();

		// Remove the instance associated with the block
		this.instance_ids[Chunk.coords_to_block_array_idx(x, y, z)] = -1;
	}

	/**
	 * Create a new mesh instance for the block at (x, y, z).
	 * 
	 * @param x The block's local X-coordinate.
	 * @param y The block's local Y-coordinate.
	 * @param z The block's local Z-coordinate.
	 */
	add_block_instance(x: number, y: number, z: number): void {
		if (!this.is_in_chunk(x, y, z)) {
			console.error("Attempted to add a block instance outside of a chunk.");
			return;
		} else if (this.current_gen_stage < GenStages.FINISHED) {
			console.warn("Attempted to add a block instance in a chunk that is not fully loaded.");
			return;
		}

		const block_idx = Chunk.coords_to_block_array_idx(x, y, z);
		const block = this.block_table[this.block_array[block_idx]]!;
		const instance_id = this.instance_ids[block_idx];

		// Verify the block exists, is not an air block type, and is not already visible
		if ((block.class.OPACITY > 0) && (instance_id < 0)) {
			// Get the mesh and instance id of the block
			const mesh: three.InstancedMesh | undefined = this.graphical_obj.children.find(
				(instance_mesh) => {return Number(instance_mesh.name) === block.ID;}
			) as three.InstancedMesh;

			if (mesh === undefined) {
				console.error("Mesh is undefined.");
				return;
			}

			const instance_id = mesh.count++;
			this.instance_ids[Chunk.coords_to_block_array_idx(x, y, z)] = instance_id;

			const matrix = new three.Matrix4();
			matrix.setPosition(x + 0.5, y + 0.5, z + 0.5);
			mesh.setMatrixAt(instance_id, matrix);
			mesh.instanceMatrix.needsUpdate = true;
			mesh.computeBoundingSphere();
		}
	}

	/**
	 * Checks if the local (x, y, z) coordinates are in bounds.
	 * 
	 * @param x The local X-coordinate
	 * @param y The local Y-coordinate
	 * @param z The local Z-coordinate
	 */
	is_in_chunk(x: number, y: number, z: number): boolean {
		return (x >= 0) && (x < CHUNK_SIDE_LENGTH) &&
		       (y >= 0) && (y < CHUNK_SIDE_LENGTH) &&
		       (z >= 0) && (z < CHUNK_SIDE_LENGTH);
	}

	/**
	 * Checks if a block has one or more exposed faces.
	 * 
	 * @param x The local X-coordinate.
	 * @param y The local Y-coordinate.
	 * @param z The local Z-coordinate.
	 */
	is_block_obscured(x: number, y: number, z: number): boolean {
		if (this.current_gen_stage < GenStages.TERRAIN_DONE) {return false;}

		const above: typeof Block =
				this.is_in_chunk(x, y, z + 1) ? this._get_block(x, y, z + 1).class : blocks.Null;
		const below: typeof Block =
				this.is_in_chunk(x, y, z - 1) ? this._get_block(x, y, z - 1).class : blocks.Null;
		const left: typeof Block =
				this.is_in_chunk(x + 1, y, z) ? this._get_block(x + 1, y, z).class : blocks.Null;
		const right: typeof Block =
				this.is_in_chunk(x - 1, y, z) ? this._get_block(x - 1, y, z).class : blocks.Null;
		const ahead: typeof Block =
				this.is_in_chunk(x, y + 1, z) ? this._get_block(x, y + 1, z).class : blocks.Null;
		const behind: typeof Block =
				this.is_in_chunk(x, y - 1, z) ? this._get_block(x, y - 1, z).class : blocks.Null;

		return (above.OPACITY >= 255) && (below.OPACITY  >= 255) &&
		       (right.OPACITY >= 255) && (left.OPACITY   >= 255) &&
		       (ahead.OPACITY >= 255) && (behind.OPACITY >= 255);
	}

	/**
	 * Calls the appropriate destructor for each object in the chunk's graphical
	 * object.
	 */
	drop() {
		// this.graphical_obj.traverse((obj: any) => {
		// 	if (obj.dispose) {obj.dispose()};
		// });
		this.graphical_obj.clear();
		Game.world.graphical_obj.remove(this.graphical_obj);
	}

	/**
	 * Saves the parts of the chunk that require saving.
	 * 
	 * @returns The CBOR-encoded chunk header.
	 */
	async save(): Promise<Uint8Array> {
		// TODO: Set the length of block table to the actual number of blocks in
		// the chunk?

		const chunk_header: ChunkHeader = new ChunkHeader();

		chunk_header.version = this.version;
		chunk_header.coords = this.COORDS;
		chunk_header.last_gen_stage = this.last_gen_stage;

		// Save block data:
		const block_id_tbl = new Uint32Array(this.block_table.length);
		const block_count_tbl = new Int32Array(this.block_table.length);
		for (let i: number = 0; i < this.block_table.length; i++) {
			block_id_tbl[i] = this.block_table[i].ID;
			block_count_tbl[i] = this.block_table[i].count;
		}
		const block_data: BlockData = {
			a: this.block_arr_entry_sz,
			b: this.block_array,
			c: block_id_tbl,
			d: block_count_tbl
		};
		const encoded_block_data = cbor.encode(block_data);
		let compressed_block_data: Uint8Array = zstd.compress(encoded_block_data, 9);
		this.block_data_offset = await this.superchunk.write_segments(
			compressed_block_data,
			this.block_data_offset >= 0 ? this.block_data_offset : undefined
		);
		chunk_header.block_data_off = this.block_data_offset;
		chunk_header.compressed_block_data_sz = compressed_block_data.byteLength;

		return cbor.encode(chunk_header);
	}
}

export const NULL = new Chunk();