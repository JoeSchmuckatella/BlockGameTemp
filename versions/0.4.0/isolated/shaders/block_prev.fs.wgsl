fn block_prev_f(
	uv: vec2<f32>,
	tex: texture_2d<f32>,
) -> vec4<f32> {
	let dims: vec2<u32> = textureDimensions(tex);
	let dims_f: vec2<f32> = vec2<f32>(f32(dims.x), f32(dims.y));
	let coords: vec2<i32> = vec2<i32>(uv * dims_f);
	let color = textureLoad(tex, coords, 0);
	if (color.a <= 0.0) {discard;}
	return textureLoad(tex, coords, 0);
}