// Copy the AR camera's current image into pixels the detector can read.
//
// With the WebXR 'camera-access' feature, the phone hands over the camera
// image as a WebGL texture, valid only inside the frame that produced it.
// It is drawn into a small texture of our own and read back: drawing (rather
// than attaching the camera texture to a framebuffer directly) is the use the
// texture is made for. The copy is scaled down to MAX_WIDTH, which is plenty
// for a detector that works at a few hundred pixels and keeps the read-back
// cheap.
//
// This changes WebGL state behind three.js's back, so the caller must call
// renderer.resetState() afterwards.
//
// NOT YET RUN ON A PHONE. Written against the WebXR Raw Camera Access spec;
// whether this phone's Chrome supports it is what the Detect button tests.

const MAX_WIDTH = 640;

const VS = `#version 300 es
in vec2 pos;
out vec2 uv;
void main() {
  uv = pos * 0.5 + 0.5;
  gl_Position = vec4(pos, 0.0, 1.0);
}`;

const FS = `#version 300 es
precision mediump float;
uniform sampler2D cameraImage;
in vec2 uv;
out vec4 colour;
void main() {
  colour = texture(cameraImage, uv);
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    throw new Error(`camera copy shader did not compile: ${gl.getShaderInfoLog(s)}`);
  }
  return s;
}

export function createCameraFrameReader(gl, session) {
  if (typeof XRWebGLBinding === 'undefined') {
    throw new Error('This browser has no XRWebGLBinding, so camera frames cannot be read.');
  }
  const binding = new XRWebGLBinding(session, gl);

  const program = gl.createProgram();
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VS));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FS));
  gl.bindAttribLocation(program, 0, 'pos');
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`camera copy program did not link: ${gl.getProgramInfoLog(program)}`);
  }
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  let target = null; // { tex, fb, width, height }

  function ensureTarget(width, height) {
    if (target && target.width === width && target.height === height) return target;
    if (target) {
      gl.deleteTexture(target.tex);
      gl.deleteFramebuffer(target.fb);
    }
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    target = { tex, fb, width, height };
    return target;
  }

  /**
   * Must be called inside the XR frame callback.
   * @param view an XRView of the current viewer pose
   * @returns {{width, height, image: ImageData, projection: number[], view: number[]}}
   */
  function read(view) {
    if (!view.camera) {
      throw new Error('The phone did not grant camera access for this session.');
    }
    const cameraTex = binding.getCameraImage(view.camera);
    if (!cameraTex) throw new Error('The phone returned no camera image for this frame.');
    const scale = Math.min(1, MAX_WIDTH / view.camera.width);
    const width = Math.round(view.camera.width * scale);
    const height = Math.round(view.camera.height * scale);

    const t = ensureTarget(width, height);
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fb);
    gl.viewport(0, 0, width, height);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.SCISSOR_TEST);
    gl.useProgram(program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, cameraTex);
    gl.uniform1i(gl.getUniformLocation(program, 'cameraImage'), 0);
    gl.bindVertexArray(vao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);

    const raw = new Uint8ClampedArray(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, raw);

    // WebGL rows run bottom-up; the detector wants top-down
    const rowBytes = width * 4;
    const pixels = new Uint8ClampedArray(raw.length);
    for (let y = 0; y < height; y++) {
      pixels.set(raw.subarray((height - 1 - y) * rowBytes, (height - y) * rowBytes), y * rowBytes);
    }
    return {
      width,
      height,
      image: new ImageData(pixels, width, height),
      projection: Array.from(view.projectionMatrix),
      view: Array.from(view.transform.matrix),
    };
  }

  return { read };
}
