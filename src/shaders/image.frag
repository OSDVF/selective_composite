precision mediump float;

uniform sampler2D image;
uniform sampler2D paint;
uniform vec3 paintColor;
uniform vec3 backPaintColor;
uniform float paintOpacity;
uniform vec2 size;
varying vec2 v_texcoord;

uniform highp mat3 projection; 

void main() {
    highp vec3 frameCoordinate = vec3(v_texcoord * size, 1.0); 
    highp vec3 trans = projection * frameCoordinate; 
    highp vec2 coords = (trans.xy/size) / trans.z; 
    if (coords.x < 0.0 || coords.x > 1.0 || coords.y < 0.0 || coords.y > 1.0) {
        discard;
    }

    gl_FragColor = vec4(mix(texture2D(image, coords).rgb, paintColor, texture2D(paint, v_texcoord).r * paintOpacity), 1.0);
    gl_FragColor.xyz = mix(gl_FragColor.xyz, backPaintColor, texture2D(paint, v_texcoord).g * paintOpacity);
}