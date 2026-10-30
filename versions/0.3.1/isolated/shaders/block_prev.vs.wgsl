fn block_prev_v(
	pos: vec3<f32>,
	model_view_mat: mat4x4<f32>,
	cam_projection_mat: mat4x4<f32>
) -> vec4<f32> {
	var clip_pos = cam_projection_mat * model_view_mat * vec4<f32>(pos, 1.0);
	clip_pos.z -= 0.0001 * clip_pos.w;
	return clip_pos;
}