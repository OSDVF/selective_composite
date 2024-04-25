import cv from '@techstark/opencv-js'
import { mat3 } from 'gl-matrix'

export enum DetectorType {
    AKAZE, ORB
}
export class Renderer {
    brushSize = 2;
    c: WebGLRenderingContext;
    detectorType = DetectorType.AKAZE;
    detectorWidthLimit = 800;
    vert: WebGLShader;
    showImage: WebGLShader;
    paintShader: WebGLShader;
    program: WebGLProgram;
    paintProgram: WebGLProgram;
    projections: number[][] = [];

    attribs: {
        position: number,
        texcoord: number,
    };
    buffers: {
        fullScreenQuad: WebGLBuffer,
        paint: WebGLFramebuffer,
    };
    uniforms: {
        image: WebGLUniformLocation,
        paint: WebGLUniformLocation,
        projection: WebGLUniformLocation | null,
        size: WebGLUniformLocation,
        paintColor: WebGLUniformLocation,
        radius: WebGLUniformLocation,
        position: WebGLUniformLocation,
    };

    images: HTMLImageElement[] = [];
    imageTextures: WebGLTexture[] = [];
    paintTextures: WebGLTexture[] = [];
    strokeTextures: WebGLTexture[] = [];

    /// -1 renders the whole composite, otherwise only single image is rendered
    selected: number = -1;
    selectedColor: number[] = [0, 0, 0];

    keypoints: cv.KeyPointVector[] = [];
    descriptors: cv.Mat[] = [];

    // Index for checking if feature points are already calculated
    cacheSrcs: string[] = [];

    knnDistance_option = 0.7;

    debugCanvas: HTMLCanvasElement | null = null;

    checkError<T>(v?: T | null): T | never {
        if (v !== null) {
            const error = this.c.getError();
            if (error != this.c.NO_ERROR) {
                throw new Error(`WebGL error: ${error}`);
            }
            return v as any;
        }
        throw new Error('WebGL error (returned object is null)');
    }

    checkShaderCompile(shader: WebGLShader): void | never {
        this.c.compileShader(shader);
        if (!this.c.getShaderParameter(shader, this.c.COMPILE_STATUS)) {
            throw new Error('Shader compile error: ' + this.c.getShaderInfoLog(shader));
        }
    }

    checkProgramLink(program: WebGLProgram): void | never {
        this.c.linkProgram(program);
        if (!this.c.getProgramParameter(program, this.c.LINK_STATUS)) {
            throw new Error('Program link error: ' + this.c.getProgramInfoLog(program));
        }
    }

    constructor(ctx: WebGLRenderingContext) {
        this.c = ctx;

        const vert = this.c.createShader(this.c.VERTEX_SHADER);
        this.vert = this.checkError(vert);
        this.c.shaderSource(this.vert, `
        attribute vec2 position;
        attribute vec2 texcoord;

        varying vec2 v_texcoord;
        void main() {
            gl_Position = vec4(position, 0, 1);
            v_texcoord = texcoord;
        }
    `);

        this.checkShaderCompile(this.vert);

        const showImage = this.c.createShader(this.c.FRAGMENT_SHADER);
        this.checkError();
        this.showImage = this.checkError(showImage);
        this.c.shaderSource(this.showImage, `
            precision mediump float;

            uniform sampler2D image;
            uniform sampler2D paint;
            uniform vec3 paintColor;
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

                gl_FragColor = vec4(mix(texture2D(image, coords).rgb, paintColor, texture2D(paint, v_texcoord).r * 0.5), 1.0);
            }
        `);
        this.checkShaderCompile(this.showImage);

        const paintShader = this.c.createShader(this.c.FRAGMENT_SHADER);
        this.checkError();
        this.paintShader = this.checkError(paintShader);
        this.c.shaderSource(this.paintShader, `
            precision mediump float;
            uniform float radius;
            uniform vec2 position;

            void main() {
                float dist = distance(gl_FragCoord.xy, position);
                if (dist > radius) {
                    discard;
                }
                gl_FragColor = vec4(1.0);
            }
        `);
        this.checkShaderCompile(this.paintShader);

        const program = this.c.createProgram();
        this.program = this.checkError(program);
        this.c.attachShader(this.program, this.vert);
        this.c.attachShader(this.program, this.showImage);
        this.checkProgramLink(this.program);

        const paintProgram = this.c.createProgram();
        this.paintProgram = this.checkError(paintProgram);
        this.c.attachShader(this.paintProgram, this.vert);
        this.c.attachShader(this.paintProgram, this.paintShader);
        this.checkProgramLink(this.paintProgram);

        const position = this.c.getAttribLocation(this.program, 'position');
        this.checkError();
        const texcoord = this.c.getAttribLocation(this.program, 'texcoord');
        this.checkError();
        this.attribs = {
            position: this.checkError(position),
            texcoord: this.checkError(texcoord),
        };

        const image = this.c.getUniformLocation(this.program, 'image');
        const projection = this.c.getUniformLocation(this.program, 'projection');
        this.checkError();
        const size = this.c.getUniformLocation(this.program, 'size');

        this.uniforms = {
            image: this.checkError(image),
            projection: projection,
            size: this.checkError(size),
            paint: this.checkError(this.c.getUniformLocation(this.program, 'paint')),
            paintColor: this.checkError(this.c.getUniformLocation(this.program, 'paintColor')),
            radius: this.checkError(this.c.getUniformLocation(this.paintProgram, 'radius')),
            position: this.checkError(this.c.getUniformLocation(this.paintProgram, 'position')),
        };


        // Full screen quad. Position and texcoord
        const fullScreenQuad = this.c.createBuffer();
        this.c.bindBuffer(this.c.ARRAY_BUFFER, fullScreenQuad);
        this.checkError();
        this.c.bufferData(this.c.ARRAY_BUFFER, new Float32Array([
            // position  texcoord
            -1, -1, 0, 1,
            1, -1, 1, 1,
            -1, 1, 0, 0,
            -1, 1, 0, 0,
            1, -1, 1, 1,
            1, 1, 1, 0,
        ]), this.c.STATIC_DRAW);
        this.checkError();

        this.buffers = {
            fullScreenQuad: this.checkError(fullScreenQuad),
            paint: this.checkError(this.c.createFramebuffer()),
        };

        this.c.enable(this.c.BLEND);
        this.checkError();
        this.c.blendFunc(this.c.SRC_ALPHA, this.c.ONE_MINUS_SRC_ALPHA);
        this.checkError();
    }

    paint(x: number, y: number) {
        if (this.selected <= 0) {
            return;
        }
        this.c.bindFramebuffer(this.c.FRAMEBUFFER, this.buffers.paint);
        this.checkError();
        this.c.framebufferTexture2D(this.c.FRAMEBUFFER, this.c.COLOR_ATTACHMENT0, this.c.TEXTURE_2D, this.paintTextures[this.selected], 0);
        this.checkError();
        this.c.viewport(0, 0, this.images[this.selected].naturalWidth, this.images[this.selected].naturalHeight);
        this.checkError();
        this.c.useProgram(this.paintProgram);
        this.checkError();
        this.c.bindBuffer(this.c.ARRAY_BUFFER, this.buffers.fullScreenQuad);
        this.checkError();
        this.c.enableVertexAttribArray(this.attribs.position);
        this.checkError();
        this.c.vertexAttribPointer(this.attribs.position, 2, this.c.FLOAT, false, 4 * 4, 0);
        this.checkError();
        this.c.enableVertexAttribArray(this.attribs.texcoord);
        this.checkError();
        this.c.vertexAttribPointer(this.attribs.texcoord, 2, this.c.FLOAT, false, 4 * 4, 2 * 4);
        this.checkError();

        this.c.uniform1f(this.uniforms.radius, this.brushSize);
        this.checkError();
        const canvasScale = this.images[this.selected].naturalWidth / this.c.canvas.width;
        this.c.uniform2f(this.uniforms.position, x * canvasScale, y * canvasScale);
        this.checkError();
        this.c.drawArrays(this.c.TRIANGLES, 0, 6);

        this.render()
    }

    updateImages() {
        const debug: cv.Mat[] = []
        for (let i = 0; i < this.images.length; i++) {
            const cached = this.cacheSrcs[i] == this.images[i].src.substring(0, 100);

            if (!cached || this.debugCanvas) {
                // proxy width and height to naturalWidth and naturalHeight
                const proxy = this.images[i].cloneNode() as HTMLImageElement
                proxy.width = Math.min(proxy.naturalWidth, this.detectorWidthLimit)
                // aspect ratio scale
                proxy.height = proxy.naturalHeight * (proxy.width / proxy.naturalWidth)
                const data = cv.imread(proxy)
                proxy.remove()
                const gray = new cv.Mat();
                cv.cvtColor(data, gray, cv.COLOR_RGBA2GRAY);
                data.delete();

                if (this.debugCanvas) {
                    debug[i] = new cv.Mat();
                    gray.copyTo(debug[i])
                }

                if (!cached) {
                    const keypoints = new cv.KeyPointVector();
                    const descriptors = new cv.Mat();

                    const detector = new (cv as any)[this.detectorType === DetectorType.AKAZE ? 'AKAZE' : 'ORB']();
                    detector.detectAndCompute(gray, new cv.Mat(), keypoints, descriptors);
                    detector.delete();

                    if (this.debugCanvas) {
                        cv.drawKeypoints(gray, keypoints, gray);
                        cv.imshow(this.debugCanvas, gray);
                    }

                    if (this.keypoints[i]) {
                        this.keypoints[i].delete();
                    }
                    if (this.descriptors[i]) {
                        this.descriptors[i].delete();
                    }
                    this.keypoints[i] = keypoints;
                    this.descriptors[i] = descriptors;

                    if (!this.imageTextures[i]) {
                        const tex = this.c.createTexture();
                        this.imageTextures[i] = this.checkError(tex);
                        this.c.bindTexture(this.c.TEXTURE_2D, tex);
                        this.checkError();

                        this.c.texParameteri(this.c.TEXTURE_2D, this.c.TEXTURE_MIN_FILTER, this.c.LINEAR);
                        this.c.texParameteri(this.c.TEXTURE_2D, this.c.TEXTURE_MAG_FILTER, this.c.LINEAR);
                        this.c.texParameteri(this.c.TEXTURE_2D, this.c.TEXTURE_WRAP_S, this.c.CLAMP_TO_EDGE);
                        this.c.texParameteri(this.c.TEXTURE_2D, this.c.TEXTURE_WRAP_T, this.c.CLAMP_TO_EDGE);
                        this.checkError();
                    }

                    this.c.texImage2D(this.c.TEXTURE_2D, 0, this.c.RGBA, this.c.RGBA, this.c.UNSIGNED_BYTE, this.images[i]);

                    if (i == 0) {// baseline image is cached early, others are after their features are matched
                        this.cacheSrcs[i] = this.images[0].src.substring(0, 100);
                    }
                }
                gray.delete()
            }
        }

        for (let i = 1; i < this.images.length; i++) {
            const im = this.images[i];
            if (this.cacheSrcs[i] == im.src.substring(0, 100)) {
                continue
            } else {
                this.cacheSrcs[i] = im.src.substring(0, 100);
            }
            // create render target for painting
            if (!this.paintTextures[i]) {
                const paint = this.c.createTexture();
                this.paintTextures[i] = this.checkError(paint);
            }
            this.c.bindTexture(this.c.TEXTURE_2D, this.paintTextures[i]);
            this.checkError();
            this.c.texImage2D(this.c.TEXTURE_2D, 0, this.c.RGB, im.naturalWidth, im.naturalHeight, 0, this.c.RGB, this.c.UNSIGNED_SHORT_5_6_5, null);
            this.checkError();
            this.c.texParameteri(this.c.TEXTURE_2D, this.c.TEXTURE_MIN_FILTER, this.c.LINEAR);
            this.checkError();
            this.c.texParameteri(this.c.TEXTURE_2D, this.c.TEXTURE_MAG_FILTER, this.c.LINEAR);
            this.checkError();
            this.c.texParameteri(this.c.TEXTURE_2D, this.c.TEXTURE_WRAP_S, this.c.CLAMP_TO_EDGE);
            this.checkError();
            this.c.texParameteri(this.c.TEXTURE_2D, this.c.TEXTURE_WRAP_T, this.c.CLAMP_TO_EDGE);
            this.checkError();

            const good_matches = new cv.DMatchVector();

            const bf = new cv.BFMatcher();
            const matches = new cv.DMatchVectorVector();

            bf.knnMatch(this.descriptors[0], this.descriptors[i], matches, 2);

            for (let j = 0; j < matches.size(); ++j) {
                let match = matches.get(j);
                let dMatch1 = match.get(0);
                let dMatch2 = match.get(1);
                if (dMatch1.distance <= dMatch2.distance * this.knnDistance_option) {
                    good_matches.push_back(dMatch1);
                }
            }

            const points1 = [];
            const points2 = [];
            for (let j = 0; j < good_matches.size(); j++) {
                points1.push(this.keypoints[0].get(good_matches.get(j).queryIdx).pt.x);
                points1.push(this.keypoints[0].get(good_matches.get(j).queryIdx).pt.y);
                points2.push(this.keypoints[i].get(good_matches.get(j).trainIdx).pt.x);
                points2.push(this.keypoints[i].get(good_matches.get(j).trainIdx).pt.y);
            }

            const mat1 = new cv.Mat(points1.length, 1, cv.CV_32FC2);
            mat1.data32F.set(points1);
            const mat2 = new cv.Mat(points2.length, 1, cv.CV_32FC2);
            mat2.data32F.set(points2);

            let h: cv.Mat|null = null;
            try {
                 h = cv.findHomography(mat1, mat2, cv.RANSAC);
            } catch (e) {
                console.error(e);
            }

            if (!h || h.empty() || isNaN(h.data64F[0])) {
                alert("Could not align image onto baseline automatically");
            }
            else {
                this.projections[i] =
                    //transpose 
                    [
                        h.data64F[0], h.data64F[3], h.data64F[6],
                        h.data64F[1], h.data64F[4], h.data64F[7],
                        h.data64F[2], h.data64F[5], h.data64F[8]
                    ];

                console.log("h:", h);
                console.log("[", h.data64F[0], ",", h.data64F[1], ",", h.data64F[2], "]");
                console.log("[", h.data64F[3], ",", h.data64F[4], ",", h.data64F[5], "]");
                console.log("[", h.data64F[6], ",", h.data64F[7], ",", h.data64F[8], "]");

                if (this.debugCanvas) {
                    const result = new cv.Mat()
                    cv.drawMatches(debug[0], this.keypoints[0], debug[i], this.keypoints[i], good_matches, result)
                    cv.imshow(this.debugCanvas, result);
                }
            }
            h?.delete()
            good_matches.delete()
            matches.delete()
            bf.delete()
        }

        for (const d of debug) {
            d?.delete();
        }
    }

    clear() {
        this.c.viewport(0, 0, this.c.canvas.width, this.c.canvas.height);
        this.checkError();
        this.c.clearColor(0, 0, 0, 1);
        this.checkError();
        this.c.clear(this.c.COLOR_BUFFER_BIT);
        this.checkError();
    }

    render() {
        this.c.bindFramebuffer(this.c.FRAMEBUFFER, null);
        this.clear()

        this.c.useProgram(this.program);
        this.checkError();

        this.c.bindBuffer(this.c.ARRAY_BUFFER, this.buffers.fullScreenQuad);
        this.checkError();

        this.c.enableVertexAttribArray(this.attribs.position);
        this.checkError();
        this.c.vertexAttribPointer(this.attribs.position, 2, this.c.FLOAT, false, 4 * 4, 0);
        this.checkError();
        this.c.enableVertexAttribArray(this.attribs.texcoord);
        this.checkError();
        this.c.vertexAttribPointer(this.attribs.texcoord, 2, this.c.FLOAT, false, 4 * 4, 2 * 4);
        this.checkError();

        if (this.selected == -1) {
            for (let i = 0; i < this.imageTextures.length; i++) {
                this.renderImage(i, false)
            }
        } else {
            this.renderImage(this.selected, true)
        }

    }

    private renderImage(i: number, renderPaint: boolean) {
        this.c.activeTexture(this.c.TEXTURE0);
        this.checkError();
        this.c.bindTexture(this.c.TEXTURE_2D, this.imageTextures[i]);
        this.checkError();
        this.c.uniform1i(this.uniforms.image, 0);
        this.checkError();
        if (renderPaint && i != 0) {
            this.c.activeTexture(this.c.TEXTURE1);
            this.checkError();
            this.c.bindTexture(this.c.TEXTURE_2D, this.paintTextures[i]);
            this.checkError();
            this.c.uniform3f(this.uniforms.paintColor, this.selectedColor[0], this.selectedColor[1], this.selectedColor[2]);
        } else {
            this.c.activeTexture(this.c.TEXTURE1);
            this.checkError();
            this.c.bindTexture(this.c.TEXTURE_2D, null);
            this.checkError();
            this.c.uniform3f(this.uniforms.paintColor, 0, 0, 0);
            this.checkError();
        }
        this.c.uniform1i(this.uniforms.paint, 1);
        this.checkError();

        // compute the dimensions used for the computation
        const width = Math.min(this.images[i].naturalWidth, this.detectorWidthLimit);
        const height = this.images[i].naturalHeight * (width / this.images[i].naturalWidth);

        this.c.uniform2f(this.uniforms.size, width, height);
        this.checkError();

        const m = this.projections[i]
        if (m) {
            this.c.uniformMatrix3fv(this.uniforms.projection, false, m);
        } else {
            const mat = mat3.create();
            this.c.uniformMatrix3fv(this.uniforms.projection, false, mat);
        }

        this.c.drawArrays(this.c.TRIANGLES, 0, 6);
        this.checkError();
    }
}