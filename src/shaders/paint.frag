precision mediump float;
uniform float radius;
uniform vec2 position;
uniform bool eraser;

void main() {
    float dist = distance(gl_FragCoord.xy, position);
    if (dist > radius) {
        discard;
    }
    gl_FragColor = eraser ? vec4(0, 0, 0, 1) : vec4(1.0);
}