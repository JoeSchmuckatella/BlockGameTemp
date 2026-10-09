attribute uint a_texture;

flat out uint v_texture;

varying vec2 v_uv;

// The main function of a GLSL vertex shader is called once per vertex (per
// frame?).
void main() {
	v_uv = uv;

	v_texture = a_texture;

	// "projectionMatrix", "modelViewMatrix", & "position" are passed in from
	// Three.js.
	gl_Position =
			projectionMatrix * modelViewMatrix * vec4(position.x, position.y, position.z, 1.0);
}