precision mediump float;

uniform sampler2D image;
uniform sampler2D paint;
uniform vec4 paintColor;
uniform vec4 backPaintColor;
uniform float paintOpacity;
uniform vec2 size;
varying vec2 v_texcoord;

uniform highp mat3 projection; 

void main() {
    highp vec3 frameCoordinate = vec3(v_texcoord * size.xy, 1.0); 
    highp vec3 trans = projection * frameCoordinate; 
    highp vec2 coords = (trans.xy/size.xy) / trans.z; 
    if (coords.x < 0.0 || coords.x > 1.0 || coords.y < 0.0 || coords.y > 1.0) {
        discard;
    }

    vec4 tex = texture2D(image, coords);
    gl_FragColor = vec4(mix(tex.rgb, paintColor.rgb, min(1., texture2D(paint, coords).r + paintColor.a) * paintOpacity), tex.a);
    gl_FragColor.xyz = mix(gl_FragColor.xyz, backPaintColor.rgb, min(1., texture2D(paint, coords).g + backPaintColor.a) * paintOpacity);
}