fn chunk_v(
	pos: vec3<f32>,
	model_view_mat: mat4x4<f32>,
	cam_projection_mat: mat4x4<f32>
) -> vec4<f32> {
	// Must return clip-space position
	return cam_projection_mat * model_view_mat * vec4<f32>(pos, 1.0);
}