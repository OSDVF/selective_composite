precision mediump float;

attribute vec2 position;
attribute vec2 texcoord;

uniform vec2 size;
varying vec2 v_texcoord;
void main() {
    gl_Position = vec4(position, 0, 1);
    v_texcoord = texcoord;
    gl_PointSize = size.x;
}