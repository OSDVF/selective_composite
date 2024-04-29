import cv from '@techstark/opencv-js'
import { glMatrix, mat3, vec3, ReadonlyMat3 } from 'gl-matrix'
import imageFrag from './shaders/image.frag?raw'
import simpleVert from './shaders/simple.vert?raw'
import paintFrag from './shaders/paint.frag?raw'
import pointFrag from './shaders/point.frag?raw'
import copyFrag from './shaders/copy.frag?raw'

if (!('spector' in globalThis)) // would cause too deep stack
    // @ts-expect-error
    import('webgl-lint') // will be replaced with empty module in production

glMatrix.setMatrixArrayType(Array)// increases performance in modern browsers

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
    c: WebGLRenderingContext;
    detectorType = DetectorType.AKAZE;
    defaultPaintBaselineSize = true;
    drawKeypoints = false;
    align = true;
    projections: ReadonlyMat3[] = [];

    attribs: {
        position: number,
        texcoord: number,

        pointPosition: number,
        pointSize: number,
        pointAngle: number,
        pointResponse: number,
        pointOctave: number,
    };
    buffers: {
        fullScreenQuad: WebGLBuffer,
        keypoints: WebGLBuffer[],
        paint: WebGLFramebuffer,
        resize: WebGLFramebuffer | null,
    };
    programs: {
        image: WebGLProgram;
        paint: WebGLProgram;
        point: WebGLProgram;
        resize: WebGLProgram;
    };
    uniforms: {
        image: WebGLUniformLocation,
        // textures
        paint: WebGLUniformLocation,//r = foreground, g = background
        projection: WebGLUniformLocation | null,
        size: WebGLUniformLocation,
        /** screen and point sizes share the same uniform name `size` - to need fewer shaders.  
        `size.x` is the outer radius, `size.y` is the inner radius */
        pointSize: WebGLUniformLocation,
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
        // resize program uniforms
        resizeImage: WebGLUniformLocation,
    };

    images: HTMLImageElement[] = [];
    imageTextures: WebGLTexture[] = [];
    // Has the same size as `images[i]`
    strokeTextures: WebGLTexture[] = [];
    // Will have the same size as `image[0]`
    compositeTextures: WebGLTexture[] = [];

    /// -1 renders the whole composite, otherwise only single image is rendered
    selected: number = -1;
    paintColor: number[] = [0, 0, 0];
    backPaintColor: number[] = [0, 0, 0];
    visualizeSegments = 0.;
    erase = false;

    keypoints: cv.KeyPointVector[] = [];
    descriptors: cv.Mat[] = [];

    // Index for checking if feature points are already calculated
    cacheSrcs: string[] = [];
    // Index for checking if composition is already calculated
    cacheComp: string[] = [];

    detectorOptions: DetectorOptions = {
        knnDistance: 0.7,
        widthLimit: 800,
        maxFeatures: 200,
        edgeThreshold: 31,
    };
    segmentationType = SegmentationType.Watershed;

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

        const vert = this.checkError(this.c.createShader(this.c.VERTEX_SHADER));
        this.c.shaderSource(vert, simpleVert);

        this.checkShaderCompile(vert);

        const showImage = this.checkError(this.c.createShader(this.c.FRAGMENT_SHADER));
        this.c.shaderSource(showImage, imageFrag);
        this.checkShaderCompile(showImage);

        const paintShader = this.checkError(this.c.createShader(this.c.FRAGMENT_SHADER));
        this.c.shaderSource(paintShader, paintFrag);
        this.checkShaderCompile(paintShader);

        const pointShader = this.checkError(this.c.createShader(this.c.FRAGMENT_SHADER))
        this.c.shaderSource(pointShader, pointFrag);
        this.checkShaderCompile(pointShader);

        const pointProgram = this.checkError(this.c.createProgram())
        this.c.attachShader(pointProgram, vert);
        this.c.attachShader(pointProgram, pointShader);
        this.checkProgramLink(pointProgram);

        const imageProgram = this.checkError(this.c.createProgram())
        this.c.attachShader(imageProgram, vert);
        this.c.attachShader(imageProgram, showImage);
        this.checkProgramLink(imageProgram);

        const paintProgram = this.checkError(this.c.createProgram())
        this.c.attachShader(paintProgram, vert);
        this.c.attachShader(paintProgram, paintShader);
        this.checkProgramLink(paintProgram);

        const resizeShader = this.checkError(this.c.createShader(this.c.FRAGMENT_SHADER));
        this.c.shaderSource(resizeShader, copyFrag);
        this.checkShaderCompile(resizeShader);

        const resizeProgram = this.checkError(this.c.createProgram())
        this.c.attachShader(resizeProgram, vert);
        this.c.attachShader(resizeProgram, resizeShader);
        this.checkProgramLink(resizeProgram);

        const position = this.c.getAttribLocation(imageProgram, 'position');
        this.checkError();
        const texcoord = this.c.getAttribLocation(imageProgram, 'texcoord');
        this.checkError();
        this.attribs = {
            position: this.checkError(position),
            texcoord: this.checkError(texcoord),

            pointPosition: this.checkError(this.c.getAttribLocation(pointProgram, 'position')),
            pointSize: this.checkError(this.c.getAttribLocation(pointProgram, 'a_size')),
            pointAngle: this.checkError(this.c.getAttribLocation(pointProgram, 'a_angle')),
            pointResponse: this.checkError(this.c.getAttribLocation(pointProgram, 'a_response')),
            pointOctave: this.checkError(this.c.getAttribLocation(pointProgram, 'a_octave')),
        };

        this.uniforms = {
            backPaintColor: this.checkError(this.c.getUniformLocation(imageProgram, 'backPaintColor')),
            image: this.checkError(this.c.getUniformLocation(imageProgram, 'image')),
            paint: this.checkError(this.c.getUniformLocation(imageProgram, 'paint')),
            paintColor: this.checkError(this.c.getUniformLocation(imageProgram, 'paintColor')),
            paintOpacity: this.checkError(this.c.getUniformLocation(imageProgram, 'paintOpacity')),
            projection: this.checkError(this.c.getUniformLocation(imageProgram, 'projection')),
            size: this.checkError(this.c.getUniformLocation(imageProgram, 'size')),

            back: this.checkError(this.c.getUniformLocation(paintProgram, 'back')),
            from: this.checkError(this.c.getUniformLocation(paintProgram, 'from')),
            radius: this.checkError(this.c.getUniformLocation(paintProgram, 'size')),
            value: this.checkError(this.c.getUniformLocation(paintProgram, 'value')),

            position: this.checkError(this.c.getUniformLocation(paintProgram, 'position')),
            pointSize: this.checkError(this.c.getUniformLocation(pointProgram, 'size')),

            resizeImage: this.checkError(this.c.getUniformLocation(resizeProgram, 'image')),
        };

        this.programs = {
            image: imageProgram,
            paint: paintProgram,
            point: pointProgram,
            resize: resizeProgram,
        };

        this.c.useProgram(resizeProgram)
        this.checkError();
        this.c.uniform2f(this.c.getUniformLocation(resizeProgram, 'size'), 0, 0);//unused in resize program
        this.checkError();

        this.setPaintOpacity(.9);
        this.setPaintRadius(5);
        this.setPointScale(5);

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
            resize: null,
        };

        this.c.enable(this.c.BLEND);
        this.checkError();
        this.c.blendFunc(this.c.SRC_ALPHA, this.c.ONE_MINUS_SRC_ALPHA);
        this.checkError();
        this.c.pixelStorei(this.c.UNPACK_ALIGNMENT, 1);
        this.checkError();
        this.c.pixelStorei(this.c.PACK_ALIGNMENT, 1);
        this.checkError();
    }

    clearPaint(background = false) {
        if (this.selected <= 0) {
            return;
        }
        delete this.cacheComp[this.selected]

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
        this.c.clearColor(0, 0, 0, 1);
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
        delete this.cacheComp[this.selected]
        const proj = this.projections[this.selected]
        const selIm = this.images[this.selected]
        const width = Math.min(selIm.naturalWidth, this.detectorOptions.widthLimit ?? selIm.naturalWidth);
        const scale = (width / selIm.naturalWidth);
        const height = selIm.naturalHeight * scale;
        
        const canvasScaleX = width / this.c.canvas.width;
        const canvasScaleY = height / this.c.canvas.height;

        const from = vec3.fromValues(fromX * canvasScaleX, fromY * canvasScaleY, 1.)
        const to = vec3.fromValues(toX * canvasScaleX, toY * canvasScaleY, 1.)
        if (proj) {
            const mat = mat3.create()
            mat3.copy(mat, proj)
            mat3.invert(mat, mat)
            vec3.transformMat3(from, from, proj)
            vec3.transformMat3(to, to, proj)

            from[0] /= width * from[2]
            from[1] /= height * from[2]
            to[0] /= width * to[2]
            to[1] /= height * to[2]
            from[0] *= selIm.naturalWidth
            from[1] *= selIm.naturalHeight
            to[0] *= selIm.naturalWidth
            to[1] *= selIm.naturalHeight
        }

        this.c.bindFramebuffer(this.c.FRAMEBUFFER, this.buffers.paint);
        this.c.framebufferTexture2D(this.c.FRAMEBUFFER,
            this.c.COLOR_ATTACHMENT0,
            this.c.TEXTURE_2D,
            this.strokeTextures[this.selected], 0
        );
        this.checkError();
        this.c.viewport(0, 0, selIm.naturalWidth, selIm.naturalHeight);
        this.c.useProgram(this.programs.paint);
        this.c.bindBuffer(this.c.ARRAY_BUFFER, this.buffers.fullScreenQuad);
        this.c.enableVertexAttribArray(this.attribs.position);
        this.c.vertexAttribPointer(this.attribs.position, 2, this.c.FLOAT, false, 4 * 4, 0);
        this.c.enableVertexAttribArray(this.attribs.texcoord);
        this.c.vertexAttribPointer(this.attribs.texcoord, 2, this.c.FLOAT, false, 4 * 4, 2 * 4);

        this.c.uniform2f(this.uniforms.from, from[0], from[1]);
        this.c.uniform2f(this.uniforms.position, to[0], to[1]);
        this.c.uniform1f(this.uniforms.value, this.erase ? 0 : 1);
        this.c.uniform1i(this.uniforms.back, background ? 1 : 0);
        this.c.drawArrays(this.c.TRIANGLES, 0, 6);

        this.render()
    }

    textureConfigureNPOT() {
        this.c.texParameteri(this.c.TEXTURE_2D, this.c.TEXTURE_MIN_FILTER, this.c.LINEAR);
        this.c.texParameteri(this.c.TEXTURE_2D, this.c.TEXTURE_MAG_FILTER, this.c.LINEAR);
        this.c.texParameteri(this.c.TEXTURE_2D, this.c.TEXTURE_WRAP_S, this.c.CLAMP_TO_EDGE);
        this.c.texParameteri(this.c.TEXTURE_2D, this.c.TEXTURE_WRAP_T, this.c.CLAMP_TO_EDGE);
    }

    composite() {
        for (let i = 1; i < this.images.length; i++) {
            if (this.cacheComp[i] == this.cacheCompKey(i)) {
                continue
            }
            try {

                // proxy width and height to naturalWidth and naturalHeight
                const proxy = this.images[i].cloneNode() as HTMLImageElement
                const w = proxy.width = proxy.naturalWidth
                const h = proxy.height = proxy.naturalHeight

                const data = cv.imread(proxy)
                cv.cvtColor(data, data, cv.COLOR_RGBA2RGB);//remove the alpha channel
                proxy.remove()
                // read paint texture
                const readback = new Uint8Array(data.rows * data.cols * 4);

                this.c.viewport(0, 0, data.cols, data.rows)
                this.c.bindFramebuffer(this.c.FRAMEBUFFER, this.buffers.paint);
                this.c.framebufferTexture2D(this.c.FRAMEBUFFER,
                    this.c.COLOR_ATTACHMENT0,
                    this.c.TEXTURE_2D,
                    this.strokeTextures[i], 0
                );
                this.c.readPixels(0, 0, data.cols, data.rows, this.c.RGBA, this.c.UNSIGNED_BYTE, readback);
                this.checkError()

                const paintChannels = cv.matFromArray(data.rows, data.cols, cv.CV_8UC4, readback);
                const paintForeground = new cv.Mat(data.rows, data.cols, cv.CV_8U)
                const paintBackground = new cv.Mat(data.rows, data.cols, cv.CV_8U)
                const list = new cv.MatVector()
                list.push_back(paintForeground)
                list.push_back(paintBackground)
                cv.split(paintChannels, list)
                list.delete()
                paintChannels.delete()

                const unknown = new cv.Mat(data.rows, data.cols, cv.CV_8U, new cv.Scalar(255));
                cv.subtract(unknown, paintForeground, unknown);
                cv.subtract(unknown, paintBackground, unknown);
                const markers = new cv.Mat();
                cv.connectedComponents(paintForeground, markers)
                for (let i = 0; i < markers.rows; i++) {
                    for (let j = 0; j < markers.cols; j++) {
                        markers.intPtr(i, j)[0] = markers.ucharPtr(i, j)[0] + 1;
                        if (unknown.ucharPtr(i, j)[0] == 255) {
                            markers.intPtr(i, j)[0] = 0;
                        }
                    }
                }
                unknown.delete()
                paintForeground.delete()
                paintBackground.delete()
                cv.watershed(data, markers)

                if (this.debugCanvas) {
                    cv.imshow(this.debugCanvas, markers)
                }

                // upload the result (data with markers as alpha) to the texture
                for (let r = 0; r < markers.rows; r++) {
                    for (let c = 0; c < markers.cols; c++) {
                        if (markers.intPtr(r, c)[0] == 1 || markers.intPtr(r, c)[0] == -1) {
                            readback[(r * w + c) * 4 + 3] = 0
                        } else {
                            readback[(r * w + c) * 4] = data.ucharPtr(r, c)[0]
                            readback[(r * w + c) * 4 + 1] = data.ucharPtr(r, c)[1]
                            readback[(r * w + c) * 4 + 2] = data.ucharPtr(r, c)[2]
                            readback[(r * w + c) * 4 + 3] = 255
                        }
                    }
                }
                markers.delete()
                data.delete()

                if (!this.compositeTextures[i]) {
                    const comp = this.c.createTexture();
                    this.compositeTextures[i] = this.checkError(comp);
                }
                this.c.bindTexture(this.c.TEXTURE_2D, this.compositeTextures[i]);
                this.textureConfigureNPOT()
                this.c.texImage2D(this.c.TEXTURE_2D, 0, this.c.RGBA, w, h, 0, this.c.RGBA, this.c.UNSIGNED_BYTE, readback);

                this.c.bindFramebuffer(this.c.FRAMEBUFFER, null)
                this.c.viewport(0, 0, this.c.canvas.width, this.c.canvas.height);
            } catch (e) {
                convertMaybeCVError(e)
            }
            this.cacheComp[i] = this.cacheCompKey(i);
        }
    }

    private cacheCompKey(i: number) {
        return this.images[i].src.substring(0, 100) + this.segmentationType + this.detectorType
    }

    private cacheKey(i: number) {
        return this.images[i].src.substring(0, 100) + this.detectorType + this.align
    }

    updateImages() {
        const debug: cv.Mat[] = []
        for (let i = 0; i < this.images.length; i++) {
            const cached = this.cacheSrcs[i] == this.cacheKey(i)

            if (!cached || this.debugCanvas) {
                try {
                    if (this.align) {
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
                            gray.delete()

                            if (this.keypoints[i]) {
                                this.keypoints[i].delete();
                            }
                            if (this.descriptors[i]) {
                                this.descriptors[i].delete();
                            }
                            this.keypoints[i] = keypoints;
                            this.descriptors[i] = descriptors;
                        }
                    }
                    const im = this.images[i]
                    if (!this.imageTextures[i]) {
                        const imTex = this.c.createTexture();
                        this.imageTextures[i] = this.checkError(imTex);

                        // create render target for painting
                        if (!this.strokeTextures[i] && (import.meta.env.DEV || i != 0)) {
                            const paint = this.c.createTexture();
                            this.strokeTextures[i] = this.checkError(paint);
                            this.c.bindTexture(this.c.TEXTURE_2D, paint);
                            this.c.texImage2D(this.c.TEXTURE_2D, 0, this.c.RGB, im.naturalWidth, im.naturalHeight, 0, this.c.RGB, this.c.UNSIGNED_SHORT_5_6_5, null);
                            this.textureConfigureNPOT()
                        }
                    }

                    this.c.bindTexture(this.c.TEXTURE_2D, this.imageTextures[i]);
                    this.checkError();
                    this.c.texImage2D(this.c.TEXTURE_2D, 0, this.c.RGB, this.c.RGB, this.c.UNSIGNED_BYTE, im);
                    this.textureConfigureNPOT()

                    if (i == 0) {// baseline image is cached early, others are after their features are matched
                        this.cacheSrcs[0] = this.cacheKey(0)
                    }
                } catch (e) {
                    convertMaybeCVError(e)
                }
            }
        }

        for (let i = 1; i < this.images.length; i++) {
            if (this.cacheSrcs[i] == this.cacheKey(i)) {
                continue
            } else {
                this.cacheSrcs[i] = this.cacheKey(i);
            }

            if (this.align) {
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
            this.composite()
            this.renderImage(this.imageTextures[0], 0, false)
            for (let i = 1; i < this.images.length; i++) {
                this.renderImage(this.compositeTextures[i], i, false)
            }

        } else if (this.images[this.selected]) {
            this.renderImage(this.imageTextures[this.selected], this.selected, true)
        }
        this.checkError();

    }

    setPaintOpacity(opacity: number) {
        this.c.useProgram(this.programs.image);
        this.c.uniform1f(this.uniforms.paintOpacity, opacity);
    }

    setPaintRadius(radius: number) {
        this.c.useProgram(this.programs.paint);
        this.checkError()
        this.c.uniform2f(this.uniforms.radius, radius, 0);
        this.checkError()
    }

    setPointScale(exp: number = 10, linear: number = 1) {
        this.c.useProgram(this.programs.point);
        this.checkError()
        this.c.uniform2f(this.uniforms.pointSize, exp, linear);
        this.checkError()
    }

    private useImageProgram() {
        this.c.useProgram(this.programs.image);
        this.checkError()

        this.c.bindBuffer(this.c.ARRAY_BUFFER, this.buffers.fullScreenQuad);
        this.checkError()

        this.c.enableVertexAttribArray(this.attribs.position);
        this.c.vertexAttribPointer(this.attribs.position, 2, this.c.FLOAT, false, 4 * 4, 0);
        this.c.enableVertexAttribArray(this.attribs.texcoord);
        this.c.vertexAttribPointer(this.attribs.texcoord, 2, this.c.FLOAT, false, 4 * 4, 2 * 4);
    }

    private renderImage(image: WebGLTexture, i: number, renderPaint: boolean) {
        this.c.activeTexture(this.c.TEXTURE0);
        this.c.bindTexture(this.c.TEXTURE_2D, image);
        this.checkError()
        this.c.uniform1i(this.uniforms.image, 0);

        this.c.activeTexture(this.c.TEXTURE1);
        this.c.bindTexture(this.c.TEXTURE_2D, renderPaint || this.visualizeSegments > 0. ? this.strokeTextures[i] : this.strokeTextures[0]/* empty one */);
        this.c.uniform1i(this.uniforms.paint, 1);
        if (renderPaint) {
            this.c.uniform4f(this.uniforms.paintColor, this.paintColor[0], this.paintColor[1], this.paintColor[2], 0.);
            this.c.uniform4f(this.uniforms.backPaintColor, this.backPaintColor[0], this.backPaintColor[1], this.backPaintColor[2], 0.);
        } else if (this.visualizeSegments > 0. && i > 0) {
            this.c.uniform4f(this.uniforms.paintColor, this.paintColor[0], this.paintColor[1], this.paintColor[2], this.visualizeSegments);
            this.c.uniform4f(this.uniforms.backPaintColor, this.backPaintColor[0], this.backPaintColor[1], this.backPaintColor[2], 0.);
        } else {
            this.c.uniform4f(this.uniforms.paintColor, 0, 0, 0, 0);
            this.c.uniform4f(this.uniforms.backPaintColor, 0, 0, 0, 0);
        }

        // compute the dimensions used for the computation
        const width = Math.min(this.images[i].naturalWidth, this.detectorOptions.widthLimit ?? this.images[i].naturalWidth);
        const scale = (width / this.images[i].naturalWidth);
        const height = this.images[i].naturalHeight * scale;
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
            this.c.useProgram(this.programs.point);
            if (!this.buffers.keypoints[i]) {
                if (!this.keypoints[i]) {
                    const align = this.align
                    this.align = true
                    this.updateImages()
                    this.align = align
                }
                this.buffers.keypoints[i] = this.checkError(this.c.createBuffer());
                const kpData = new Float32Array(this.keypoints[i].size() * 6);
                let numOctaves = 1;
                for (let j = 0; j < this.keypoints[i].size(); j++) {
                    const kp = this.keypoints[i].get(j);
                    if (kp.octave > numOctaves) {
                        numOctaves = kp.octave;
                    }
                }

                for (let j = 0; j < this.keypoints[i].size(); j++) {
                    const kp = this.keypoints[i].get(j);
                    const pos = vec3.fromValues(kp.pt.x, kp.pt.y, 1.)
                    if (this.projections[i]) {
                        const mat = mat3.create()
                        mat3.copy(mat, this.projections[i])
                        mat3.invert(mat, mat)
                        vec3.transformMat3(pos, pos, mat)
                    }

                    pos[0] /= width * pos[2];
                    pos[1] /= height * pos[2];
                    pos[0] = (pos[0]) * 2 - 1
                    pos[1] = - ((pos[1]) * 2 - 1)

                    kpData[j * 6] = pos[0]
                    kpData[j * 6 + 1] = pos[1]
                    kpData[j * 6 + 2] = Math.log10(kp.size);
                    kpData[j * 6 + 3] = (kp.angle * .5) / Math.PI * 255;
                    kpData[j * 6 + 4] = kp.response * 50;
                    kpData[j * 6 + 5] = kp.octave / numOctaves;
                }
                this.c.bindBuffer(this.c.ARRAY_BUFFER, this.buffers.keypoints[i]);
                this.c.bufferData(this.c.ARRAY_BUFFER, kpData, this.c.STATIC_DRAW);
            }
            this.c.bindBuffer(this.c.ARRAY_BUFFER, this.buffers.keypoints[i]);
            this.c.disableVertexAttribArray(this.attribs.texcoord);

            this.c.enableVertexAttribArray(this.attribs.pointPosition);
            this.c.vertexAttribPointer(this.attribs.pointPosition, 2, this.c.FLOAT, false, 6 * 4, 0);
            this.c.enableVertexAttribArray(this.attribs.pointSize);
            this.c.vertexAttribPointer(this.attribs.pointSize, 1, this.c.FLOAT, false, 6 * 4, 2 * 4);
            this.c.enableVertexAttribArray(this.attribs.pointAngle);
            this.c.vertexAttribPointer(this.attribs.pointAngle, 1, this.c.FLOAT, false, 6 * 4, 3 * 4);
            this.c.enableVertexAttribArray(this.attribs.pointResponse);
            this.c.vertexAttribPointer(this.attribs.pointResponse, 1, this.c.FLOAT, false, 6 * 4, 4 * 4);
            this.c.enableVertexAttribArray(this.attribs.pointOctave);
            this.c.vertexAttribPointer(this.attribs.pointOctave, 1, this.c.FLOAT, false, 6 * 4, 5 * 4);

            this.c.drawArrays(this.c.POINTS, 0, this.keypoints[i].size());

            this.useImageProgram()
        }
    }
}

function convertMaybeCVError(e: unknown): never {
    switch (typeof e) {
        case 'number':
            console.error('Error ptr:', e)
            throw cv.exceptionFromPtr(e)
        default:
            throw e
    }
}