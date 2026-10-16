fn chunk_f(
		uv: vec2<f32>,
		layer: u32,
		color_tex: texture_2d_array<f32>,
		transparent: bool
	) -> vec4<f32> {
		let dims = vec2<f32>(textureDimensions(color_tex, 0).xy);

		// Half-texel inset to avoid edge-bleeding/seams:
		let inset = 0.5 / dims;
		let safe_uv = clamp(uv, inset, 1.0 - inset);

		let coords = vec2<i32>(safe_uv * dims);

		var color = textureLoad(color_tex, coords, i32(layer), 0);
		if ((color.a <= 0.0) && transparent) {
			discard;
		} else if ((color.a <= 0.0) && !transparent) {
			// Black
			color = vec4<f32>(0.0, 0.0, 0.0, 1.0);
		}

		return color;
	}