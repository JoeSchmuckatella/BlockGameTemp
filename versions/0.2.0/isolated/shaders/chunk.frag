uniform sampler2DArray u_TEXTURES;
uniform bool u_transparent;

flat in uint v_texture;

varying vec2 v_uv;

// The main function of a GLSL fragment shader is called once per fragment
// (per triangle per frame?).
void main() {

	gl_FragColor = texture2D(u_TEXTURES, vec3(v_uv.x, v_uv.y, v_texture));

	// Three.js sets the alpha channels to solid white if transparency is
	// turned off and renders the sky backgound color when facing east. This
	// conditional corrects that.
	// FIXME: This only works for leaves, some blocks should always be transparent.
	if (gl_FragColor.a <= 0.0 && u_transparent) {
		discard;
	} else if (gl_FragColor.a <= 0.0 && !u_transparent) {
		// Render transparent fragments as solid black:
		gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
	}
}