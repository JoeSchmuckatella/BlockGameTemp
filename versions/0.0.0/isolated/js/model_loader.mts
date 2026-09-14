
import {GLTFLoader} from "three/examples/jsm/loaders/GLTFLoader.js";

export class ModelLoader {
	loader = new GLTFLoader();
	
	models = {
		pickaxe: undefined,
	};
	
	/**
	 * Loads 3D models into memory
	 */
	load_models(on_load: (obj: {pickaxe: any}) => void) {
		// File path is relative to index.html
		this.loader.load(
			"../../../lib/goodvibes/models/pickaxe.glb",
			(model: any) => {
				const mesh = model.scene;
				this.models.pickaxe = mesh;
				on_load(this.models);
			},
			undefined,
			undefined
		);
	}
}