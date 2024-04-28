precision mediump float;

varying float v_angle;
varying float v_response;
varying float v_octave;

void main() {
    gl_FragColor = vec4(v_angle, v_response, v_octave, 1.0);
}