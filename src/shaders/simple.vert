// common vertex shader for all the programs
precision mediump float;

attribute vec2 position;
attribute vec2 texcoord;
// for keypoints
attribute float a_size;
attribute float a_angle;
attribute float a_response;
attribute float a_octave;


uniform vec2 size;
varying vec2 v_texcoord;
// for keypoints
varying float v_angle;
varying float v_response;
varying float v_octave;

void main() {
    gl_Position = vec4(position, 0, 1);
    v_texcoord = texcoord;
    gl_PointSize = pow(a_size, size.x) * size.y;// x is logarithmic, y linear scaling factor

    // for keypoints
    v_angle = a_angle;
    v_response = a_response;
    v_octave = a_octave;
}