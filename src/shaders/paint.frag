precision mediump float;
uniform vec2 size;
uniform vec2 from;
uniform vec2 position;
uniform float value;
uniform bool back;

void main() {
    // draw a segment with rounded ends and the thickness of `size.x` between `from` and `position`
    // the current fragment is at `gl_FragCoord.xy`
    vec2 dir = position - from;
    vec2 closestPoint;
    if(length(dir) < 0.0001) {
        closestPoint = from;
    } else {
        vec2 normDir = normalize(dir);
        vec2 toPoint = gl_FragCoord.xy - from;
        float t = dot(toPoint, normDir);

        if(t < 0.0) {
            closestPoint = from;
        } else if(t > length(dir)) {
            closestPoint = position;
        } else {
            closestPoint = from + t * normDir;
        }
    }

    float dist = length(gl_FragCoord.xy - closestPoint);
    if(dist < size.x / 2.0) {
        // paint
        if(back) {
            gl_FragColor = vec4(0.0, value, 0.0, 1.);
        } else {
            gl_FragColor = vec4(value, 0.0, 0.0, 1.);

        }
    } else {
        discard;
    }
}