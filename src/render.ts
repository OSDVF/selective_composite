import cv from '@techstark/opencv-js'
import { mat3 } from 'gl-matrix'
import imageFrag from './shaders/image.frag?raw'
import simpleVert from './shaders/simple.vert?raw'
import paintFrag from './shaders/paint.frag?raw'
import pointFrag from './shaders/point.frag?raw'
import 'webgl-lint' // will be replaced with empty module in production

export enum SegmentationType {
    Watershed
}

export enum DetectorType {
    AKAZE, ORB
}

export type DetectorOptions = {
    knnDistance: number,
    widthLimit?: number,
    maxFeatures?: number,
    edgeThreshold?: number,
}

export class Renderer {
    brushSize = 2;
    c: WebGLRenderingContext;
    detectorType = DetectorType.AKAZE;
    drawKeypoints = false;
    vert: WebGLShader;
    showImage: WebGLShader;
    paintShader: WebGLShader;
    pointShader: WebGLShader;
    pointProgram: WebGLProgram;
    imageProgram: WebGLProgram;
    paintProgram: WebGLProgram;
    projections: number[][] = [];

    attribs: {
        position: number,
        texcoord: number,
    };
    buffers: {
        fullScreenQuad: WebGLBuffer,
        paint: WebGLFramebuffer,
        keypoints: WebGLBuffer[],
    };
    uniforms: {
        image: WebGLUniformLocation,
        // textures
        paint: WebGLUniformLocation,//r = foreground, g = background
        projection: WebGLUniformLocation | null,
        size: WebGLUniformLocation,
        pointSize: WebGLUniformLocation,
        pointColor: WebGLUniformLocation,
        // colors
        paintColor: WebGLUniformLocation,
        backPaintColor: WebGLUniformLocation,
        paintOpacity: WebGLUniformLocation,
        // paint program uniforms
        value: WebGLUniformLocation,
        back: WebGLUniformLocation,
        radius: WebGLUniformLocation,
        from: WebGLUniformLocation,
        position: WebGLUniformLocation,
    };

    images: HTMLImageElement[] = [];
    imageTextures: WebGLTexture[] = [];
    strokeTextures: WebGLTexture[] = [];

    /// -1 renders the whole composite, otherwise only single image is rendered
    selected: number = -1;
    paintColor: number[] = [0, 0, 0];
    backPaintColor: number[] = [0, 0, 0];
    erase = false;

    keypoints: cv.KeyPointVector[] = [];
    descriptors: cv.Mat[] = [];

    // Index for checking if feature points are already calculated
    cacheSrcs: string[] = [];

    detectorOptions: DetectorOptions = {
        knnDistance: 0.7,
        widthLimit: 800,
        maxFeatures: 200,
        edgeThreshold: 31,
    };

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
        this.c.shaderSource(this.vert, simpleVert);

        this.checkShaderCompile(this.vert);

        const showImage = this.c.createShader(this.c.FRAGMENT_SHADER);
        this.checkError();
        this.showImage = this.checkError(showImage);
        this.c.shaderSource(this.showImage, imageFrag);
        this.checkShaderCompile(this.showImage);

        const paintShader = this.c.createShader(this.c.FRAGMENT_SHADER);
        this.checkError();
        this.paintShader = this.checkError(paintShader);
        this.c.shaderSource(this.paintShader, paintFrag);
        this.checkShaderCompile(this.paintShader);

        const pointShader = this.c.createShader(this.c.FRAGMENT_SHADER);
        this.checkError();
        this.pointShader = this.checkError(pointShader);
        this.c.shaderSource(this.pointShader, pointFrag);
        this.checkShaderCompile(this.pointShader);

        const pointProgram = this.c.createProgram();
        this.pointProgram = this.checkError(pointProgram);
        this.c.attachShader(this.pointProgram, this.vert);
        this.c.attachShader(this.pointProgram, this.pointShader);
        this.checkProgramLink(this.pointProgram);

        const program = this.c.createProgram();
        this.imageProgram = this.checkError(program);
        this.c.attachShader(this.imageProgram, this.vert);
        this.c.attachShader(this.imageProgram, this.showImage);
        this.checkProgramLink(this.imageProgram);

        const paintProgram = this.c.createProgram();
        this.paintProgram = this.checkError(paintProgram);
        this.c.attachShader(this.paintProgram, this.vert);
        this.c.attachShader(this.paintProgram, this.paintShader);
        this.checkProgramLink(this.paintProgram);

        const position = this.c.getAttribLocation(this.imageProgram, 'position');
        this.checkError();
        const texcoord = this.c.getAttribLocation(this.imageProgram, 'texcoord');
        this.checkError();
        this.attribs = {
            position: this.checkError(position),
            texcoord: this.checkError(texcoord),
        };

        const image = this.c.getUniformLocation(this.imageProgram, 'image');
        const projection = this.c.getUniformLocation(this.imageProgram, 'projection');
        this.checkError();
        const size = this.c.getUniformLocation(this.imageProgram, 'size');

        this.uniforms = {
            image: this.checkError(image),
            projection: projection,
            size: this.checkError(size),
            paint: this.checkError(this.c.getUniformLocation(this.imageProgram, 'paint')),
            pointSize: this.checkError(this.c.getUniformLocation(this.pointProgram, 'size')),
            pointColor: this.checkError(this.c.getUniformLocation(this.pointProgram, 'color')),
            paintColor: this.checkError(this.c.getUniformLocation(this.imageProgram, 'paintColor')),
            backPaintColor: this.checkError(this.c.getUniformLocation(this.imageProgram, 'backPaintColor')),
            paintOpacity: this.checkError(this.c.getUniformLocation(this.imageProgram, 'paintOpacity')),
            value: this.checkError(this.c.getUniformLocation(this.paintProgram, 'value')),
            back: this.checkError(this.c.getUniformLocation(this.paintProgram, 'back')),
            radius: this.checkError(this.c.getUniformLocation(this.paintProgram, 'radius')),
            from: this.checkError(this.c.getUniformLocation(this.paintProgram, 'from')),
            position: this.checkError(this.c.getUniformLocation(this.paintProgram, 'position')),
        };

        this.c.useProgram(this.paintProgram);
        this.checkError();
        this.c.uniform2f(this.c.getUniformLocation(this.paintProgram, 'size'), 0, 0);//unused in paint program
        this.checkError();

        this.setPaintOpacity(.9);

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
            keypoints: [],
        };

        this.c.enable(this.c.BLEND);
        this.checkError();
        this.c.blendFunc(this.c.SRC_ALPHA, this.c.ONE_MINUS_SRC_ALPHA);
        this.checkError();
    }

    clearPaint(background = false) {
        this.c.bindFramebuffer(this.c.FRAMEBUFFER, this.buffers.paint);
        this.checkError()
        this.c.framebufferTexture2D(this.c.FRAMEBUFFER,
            this.c.COLOR_ATTACHMENT0,
            this.c.TEXTURE_2D,
            this.strokeTextures[this.selected], 0
        );
        this.checkError()
        // foreground means clearing the R channel
        this.c.colorMask(!background, background, false, true);
        this.checkError()
        this.c.clearColor(0,0, 0, 1);
        this.checkError()
        this.c.clear(this.c.COLOR_BUFFER_BIT);
        this.checkError()
        this.c.colorMask(true, true, true, true);
        this.checkError()
        this.render()
    }

    paint(fromX: number, fromY: number, toX: number, toY: number, background: boolean) {
        if (this.selected <= 0) {
            return;
        }
        this.c.bindFramebuffer(this.c.FRAMEBUFFER, this.buffers.paint);
        this.c.framebufferTexture2D(this.c.FRAMEBUFFER,
            this.c.COLOR_ATTACHMENT0,
            this.c.TEXTURE_2D,
            this.strokeTextures[this.selected], 0
        );
        this.checkError();
        this.c.viewport(0, 0, this.images[this.selected].naturalWidth, this.images[this.selected].naturalHeight);
        this.c.useProgram(this.paintProgram);
        this.c.bindBuffer(this.c.ARRAY_BUFFER, this.buffers.fullScreenQuad);
        this.c.enableVertexAttribArray(this.attribs.position);
        this.c.vertexAttribPointer(this.attribs.position, 2, this.c.FLOAT, false, 4 * 4, 0);
        this.c.enableVertexAttribArray(this.attribs.texcoord);
        this.c.vertexAttribPointer(this.attribs.texcoord, 2, this.c.FLOAT, false, 4 * 4, 2 * 4);

        this.c.uniform1f(this.uniforms.radius, this.brushSize);
        const canvasScale = this.images[this.selected].naturalWidth / this.c.canvas.width;
        this.c.uniform2f(this.uniforms.from, fromX * canvasScale, fromY * canvasScale);
        this.c.uniform2f(this.uniforms.position, toX * canvasScale, toY * canvasScale);
        this.c.uniform1f(this.uniforms.value, this.erase ? 0 : 1);
        this.c.uniform1i(this.uniforms.back, background ? 1 : 0);
        this.c.drawArrays(this.c.TRIANGLES, 0, 6);

        this.render()
    }

    updateImages() {
        const debug: cv.Mat[] = []
        for (let i = 0; i < this.images.length; i++) {
            const cached = this.cacheSrcs[i] == this.images[i].src.substring(0, 100) + this.detectorType;

            if (!cached || this.debugCanvas) {
                // proxy width and height to naturalWidth and naturalHeight
                const proxy = this.images[i].cloneNode() as HTMLImageElement
                proxy.width = Math.min(proxy.naturalWidth, this.detectorOptions.widthLimit ?? proxy.naturalWidth)
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

                    const detector: cv.Feature2D = this.detectorType === DetectorType.AKAZE ? new (cv as any).AKAZE() : new cv.ORB(this.detectorOptions.maxFeatures);
                    if (this.detectorType === DetectorType.ORB && this.detectorOptions.edgeThreshold) {
                        (detector as any).setEdgeThreshold(this.detectorOptions.edgeThreshold)
                    }
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
                        const imTex = this.c.createTexture();
                        const im = this.images[i]
                        this.imageTextures[i] = this.checkError(imTex);
                        this.c.bindTexture(this.c.TEXTURE_2D, imTex);
                        this.checkError();

                        // create render target for painting
                        if (!this.strokeTextures[i] && (import.meta.hot || i != 0)) {
                            const paint = this.c.createTexture();
                            this.strokeTextures[i] = this.checkError(paint);
                        }
                        for (const tex of [this.strokeTextures[i], imTex]) {
                            if (!tex) continue
                            this.c.bindTexture(this.c.TEXTURE_2D, tex);
                            this.c.texImage2D(this.c.TEXTURE_2D, 0, this.c.RGB, im.naturalWidth, im.naturalHeight, 0, this.c.RGB, this.c.UNSIGNED_SHORT_5_6_5, null);
                            this.c.texParameteri(this.c.TEXTURE_2D, this.c.TEXTURE_MIN_FILTER, this.c.LINEAR);
                            this.c.texParameteri(this.c.TEXTURE_2D, this.c.TEXTURE_MAG_FILTER, this.c.LINEAR);
                            this.c.texParameteri(this.c.TEXTURE_2D, this.c.TEXTURE_WRAP_S, this.c.CLAMP_TO_EDGE);
                            this.c.texParameteri(this.c.TEXTURE_2D, this.c.TEXTURE_WRAP_T, this.c.CLAMP_TO_EDGE);
                        }
                    }

                    this.c.texImage2D(this.c.TEXTURE_2D, 0, this.c.RGBA, this.c.RGBA, this.c.UNSIGNED_BYTE, this.images[i]);

                    if (i == 0) {// baseline image is cached early, others are after their features are matched
                        this.cacheSrcs[i] = this.images[0].src.substring(0, 100) + this.detectorType;
                    }
                }
                gray.delete()
            }
        }

        for (let i = 1; i < this.images.length; i++) {
            const im = this.images[i];
            if (this.cacheSrcs[i] == im.src.substring(0, 100) + this.detectorType) {
                continue
            } else {
                this.cacheSrcs[i] = im.src.substring(0, 100) + this.detectorType;
            }

            const good_matches = new cv.DMatchVector();

            const bf = new cv.BFMatcher();
            const matches = new cv.DMatchVectorVector();

            bf.knnMatch(this.descriptors[0], this.descriptors[i], matches, 2);

            for (let j = 0; j < matches.size(); ++j) {
                let match = matches.get(j);
                let dMatch1 = match.get(0);
                let dMatch2 = match.get(1);
                if (dMatch1.distance <= dMatch2.distance * this.detectorOptions.knnDistance) {
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

            let h: cv.Mat | null = null;
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
        this.checkError()
        this.c.clearColor(0, 0, 0, 1);
        this.checkError()
        this.c.clear(this.c.COLOR_BUFFER_BIT);
        this.checkError()
    }

    render() {
        this.c.bindFramebuffer(this.c.FRAMEBUFFER, null);
        this.checkError()
        this.clear()

        this.useImageProgram()

        if (this.selected == -1) {
            for (let i = 0; i < this.imageTextures.length; i++) {
                this.renderImage(i, false)
            }
        } else if (this.images[this.selected]) {
            this.renderImage(this.selected, true)
        }
        this.checkError();

    }

    public setPaintOpacity(opacity: number) {
        this.c.useProgram(this.imageProgram);
        this.c.uniform1f(this.uniforms.paintOpacity, opacity);
    }

    private useImageProgram() {
        this.c.useProgram(this.imageProgram);
        this.checkError()

        this.c.bindBuffer(this.c.ARRAY_BUFFER, this.buffers.fullScreenQuad);
        this.checkError()

        this.c.enableVertexAttribArray(this.attribs.position);
        this.c.vertexAttribPointer(this.attribs.position, 2, this.c.FLOAT, false, 4 * 4, 0);
        this.c.enableVertexAttribArray(this.attribs.texcoord);
        this.c.vertexAttribPointer(this.attribs.texcoord, 2, this.c.FLOAT, false, 4 * 4, 2 * 4);
    }

    private renderImage(i: number, renderPaint: boolean) {
        this.c.activeTexture(this.c.TEXTURE0);
        this.c.bindTexture(this.c.TEXTURE_2D, this.imageTextures[i]);
        this.checkError()
        this.c.uniform1i(this.uniforms.image, 0);
        this.c.activeTexture(this.c.TEXTURE1);
        this.c.bindTexture(this.c.TEXTURE_2D, this.strokeTextures[i]);
        if (renderPaint) {
            this.c.uniform3f(this.uniforms.paintColor, this.paintColor[0], this.paintColor[1], this.paintColor[2]);
            this.c.uniform3f(this.uniforms.backPaintColor, this.backPaintColor[0], this.backPaintColor[1], this.backPaintColor[2]);
        } else {
            this.c.uniform3f(this.uniforms.paintColor, 0, 0, 0);
            this.c.uniform3f(this.uniforms.backPaintColor, 0, 0, 0);
        }
        this.c.uniform1i(this.uniforms.paint, 1);

        // compute the dimensions used for the computation
        const width = Math.min(this.images[i].naturalWidth, this.detectorOptions.widthLimit ?? this.images[i].naturalWidth);
        const height = this.images[i].naturalHeight * (width / this.images[i].naturalWidth);

        this.c.uniform2f(this.uniforms.size, width, height);

        const m = this.projections[i]
        if (m) {
            this.c.uniformMatrix3fv(this.uniforms.projection, false, m);
        } else {
            const mat = mat3.create();
            this.c.uniformMatrix3fv(this.uniforms.projection, false, mat);
        }

        this.c.drawArrays(this.c.TRIANGLES, 0, 6);

        if (this.drawKeypoints) {
            this.c.useProgram(this.pointProgram);
            if (!this.buffers.keypoints[i]) {
                this.buffers.keypoints[i] = this.checkError(this.c.createBuffer());
                this.c.bindBuffer(this.c.ARRAY_BUFFER, this.buffers.keypoints[i]);
                const kpData = new Float32Array(this.keypoints[i].size() * 2);
                for (let j = 0; j < this.keypoints[i].size(); j++) {
                    const kp = this.keypoints[i].get(j);
                    kpData[j * 2] = kp.pt.x;
                    kpData[j * 2 + 1] = kp.pt.y;
                }
                this.c.bufferData(this.c.ARRAY_BUFFER, kpData, this.c.STATIC_DRAW);
            }
            this.c.bindBuffer(this.c.ARRAY_BUFFER, this.buffers.keypoints[i]);
            this.c.enableVertexAttribArray(this.attribs.position);
            this.c.vertexAttribPointer(this.attribs.position, 2, this.c.FLOAT, false, 0, 0);

            this.c.uniform1f(this.uniforms.pointSize, 5);
            this.c.uniform3f(this.uniforms.pointColor, 1, 0, 0);

            this.c.drawArrays(this.c.POINTS, 0, this.keypoints[i].size());

            this.useImageProgram()
        }
    }
}