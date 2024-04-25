import cv from '@techstark/opencv-js'

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
    program: WebGLProgram;

    attribs: {
        position: number,
        texcoord: number,
    };
    buffers: {
        fullScreenQuad: WebGLBuffer,
    };
    uniforms: {
        image: WebGLUniformLocation,
    };

    images: HTMLImageElement[] = [];
    imageTextures: WebGLTexture[] = [];
    stencilTextures: WebGLTexture[] = [];
    strokeTextures: WebGLTexture[] = [];

    /// -1 renders the whole composite, otherwise only single image is rendered
    selected: number = -1;

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
        varying vec2 v_texcoord;

        void main() {
            gl_FragColor = texture2D(image, v_texcoord);
        }
    `);

        this.checkShaderCompile(this.showImage);

        const program = this.c.createProgram();
        this.program = this.checkError(program);
        this.c.attachShader(this.program, this.vert);
        this.c.attachShader(this.program, this.showImage);
        this.checkProgramLink(this.program);

        const position = this.c.getAttribLocation(this.program, 'position');
        this.checkError();
        const texcoord = this.c.getAttribLocation(this.program, 'texcoord');
        this.checkError();
        this.attribs = {
            position: this.checkError(position),
            texcoord: this.checkError(texcoord),
        };

        const image = this.c.getUniformLocation(this.program, 'image');
        this.uniforms = {
            image: this.checkError(image),
        };


        // Full screen quad. Position and texcoord
        const fullScreenQuad = this.c.createBuffer();
        this.c.bindBuffer(this.c.ARRAY_BUFFER, fullScreenQuad);
        this.checkError();
        this.c.bufferData(this.c.ARRAY_BUFFER, new Float32Array([
            // position  texcoord
            -1, -1, 0, 0,
            1, -1, 1, 0,
            -1, 1, 0, 1,
            -1, 1, 0, 1,
            1, -1, 1, 0,
            1, 1, 1, 1,
        ]), this.c.STATIC_DRAW);
        this.checkError();

        this.buffers = {
            fullScreenQuad: this.checkError(fullScreenQuad),
        };

        this.c.enable(this.c.BLEND);
        this.checkError();
        this.c.blendFunc(this.c.SRC_ALPHA, this.c.ONE_MINUS_SRC_ALPHA);
        this.checkError();
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
                    if (i == 0) {
                        this.c.texImage2D(this.c.TEXTURE_2D, 0, this.c.RGBA, this.c.RGBA, this.c.UNSIGNED_BYTE, this.images[i]);
                    }

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

            // compute the scale for the processed vs the original image
            const scale0 = Math.min(this.detectorWidthLimit / this.images[0].naturalWidth, 1)
            const scale1 = Math.min(this.detectorWidthLimit / im.naturalWidth, 1)

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

            const h = cv.findHomography(mat2, mat1, cv.RANSAC);

            if (h.empty() || isNaN(h.data64F[0])) {
                alert("Could not align image onto baseline automatically");
            }
            else {
                const proxy = this.images[i].cloneNode() as HTMLImageElement
                proxy.width = proxy.naturalWidth
                proxy.height = proxy.naturalHeight
                const source = cv.imread(proxy)
                proxy.remove()
                
                cv.warpPerspective(source, source, h, new cv.Size(source.cols, source.rows))

                this.c.bindTexture(this.c.TEXTURE_2D, this.imageTextures[i]);
                // OpenCV to WebGL texture
                this.c.texImage2D(this.c.TEXTURE_2D, 0, this.c.RGBA, this.c.RGBA, this.c.UNSIGNED_BYTE, new ImageData(new Uint8ClampedArray(source.data), source.cols, source.rows));
                source.delete()

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
            h.delete()
            mat1.delete()
            mat2.delete()
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
                this.renderImage(i)
            }
        } else {
            this.renderImage(this.selected)
        }

    }

    private renderImage(i: number) {
        this.c.activeTexture(this.c.TEXTURE0);
        this.checkError();
        this.c.bindTexture(this.c.TEXTURE_2D, this.imageTextures[i]);
        this.checkError();
        this.c.uniform1i(this.uniforms.image, 0);
        this.checkError();

        this.c.drawArrays(this.c.TRIANGLES, 0, 6);
        this.checkError();
    }
}