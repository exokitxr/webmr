console.log('node boot html start');

// ENVIRONMENT

const path = require('path');
const browserPoly = require('browser-poly');

const {window} = browserPoly();
const {document, fetch} = window;

// CALLBACKS

global.onSurfaceCreated = () => {
  console.log('js onSurfaceCreated');

  if (!animating) {
    animating = true;

    _startAnimation();
  }
};
global.onSurfaceChanged = (width, height) => {
  console.log('js onSurfaceChanged', {width, height});

  // gl.viewport(0, 0, width, height);

  window.innerWidth = width;
  window.innerHeight = height;

  renderer.setSize(width, height);
  /* camera.aspect = width / height;
  camera.updateProjectionMatrix(); */
};

// VR
global.onNewFrame = (headViewMatrixFloat32Array, headQuaternionFloat32Array) => {
  // console.log('js onNewFrame', headViewMatrixFloat32Array, headQuaternionFloat32Array);
};
global.onDrawEye = (eyeViewMatrixFloat32Array, eyePerspectiveMatrixFloat32Array) => {
  // console.log('js onDrawEye', eyeViewMatrixFloat32Array, eyePerspectiveMatrixFloat32Array);
};

// AR
global.onDrawFrame = (viewMatrixFloat32Array, projectionMatrixFloat32Array) => {
  camera.matrixWorldInverse.fromArray(viewMatrixFloat32Array);
  camera.matrixWorld.getInverse(camera.matrixWorldInverse);
  camera.projectionMatrix.fromArray(projectionMatrixFloat32Array);

  window.tickAnimationFrame();
};

// MAIN

const THREE = require('three-zeo');
const skinJs = require('skin-js');
const skinJsPath = path.dirname(require.resolve('skin-vr'));
const skin = skinJs(THREE);

const appUrl = 'http://192.168.0.13:8000/';
fetch(appUrl)
  .then(res => res.text())
  .then(htmlString => {
    const htmlWindow = browserPoly(htmlString, {
      url: appUrl,
      // referrer: "https://example.com/",
      contentType: 'text/html',
      runScripts: 'dangerously',
    }).window;
    htmlWindow.addEventListener('error', err => {
      console.warn('got error', err.error.stack);
    });
  });

const canvas = document.createElement('canvas');
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;
const gl = canvas.getContext('webgl');
let renderer = null;
let camera = null;

let animating = false;
const _startAnimation = () => {
  console.log('node html start animation');

  gl.enable = () => {};
  gl.disable = () => {};
  gl.clear = () => {};

  renderer = new THREE.WebGLRenderer({
    canvas,
    context: gl,
    antialias: true,
    alpha: true,
    preserveDrawingBuffer: true,
  });
  renderer.autoClear = false;
  // console.log('disable', gl.DEPTH_TEST);
  // gl.disable(gl.DEPTH_TEST);
  // console.log('disable', gl.CULL_FACE);
  // gl.disable(gl.CULL_FACE);
  // renderer.setSize(canvas.width, canvas.height);
  renderer.setClearColor(0x000000, 0);
  // renderer.setClearColor(0xFF0000, 0.5);

  const scene = new THREE.Scene();
  scene.matrixAutoUpdate = false;

  camera = new THREE.PerspectiveCamera(90, canvas.width / canvas.height, 0.1, 100);
  camera.position.set(2, 2, 2);
  camera.updateMatrixWorld();
  camera.lookAt(new THREE.Vector3(0, 0, 0));
  camera.matrixAutoUpdate = false;
  scene.add(camera);

  const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
  scene.add(ambientLight);

  const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
  directionalLight.position.set(3, 3, 3);
  directionalLight.updateMatrixWorld();
  scene.add(directionalLight);

  /* const boxMesh = (() => {
    const geometry = new THREE.BoxBufferGeometry(0.1, 0.1, 0.1);
    const material = new THREE.MeshPhongMaterial({
      color: 0xff8000,
      // side: THREE.DoubleSide,
    });
    return new THREE.Mesh(geometry, material);
  })();
  boxMesh.updateMatrixWorld();
  scene.add(boxMesh); */

  const _requestImage = src => new Promise((accept, reject) => {
    const img = new Image();
    img.onload = () => {
      console.log('image onload', img.data.length);

      accept(img);
    };
    img.onerror = err => {
      console.log('image onerror', err);

      reject(err);
    };
    img.src = src;
  });

  const skinMesh = (() => {
    const object = new THREE.Object3D();

    _requestImage(path.join(skinJsPath, 'lib', 'img', 'female.png'))
      .then(skinImg => {
        const mesh = skin(skinImg);
        object.add(mesh);
      });

    return object;
  })();
  scene.add(skinMesh);

  // const startTime = Date.now();

  const _recurse = () => {
    renderer.state.reset();

    /* const factor = ((startTime - Date.now()) % 2000) / 2000;
    camera.position.set(0, 1, 2)
      .applyQuaternion(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), factor * Math.PI * 2));
    camera.lookAt(new THREE.Vector3(0, 0, 0)); */

    // console.log('view matrix', camera.matrixWorld.toArray().join(','), camera.matrixWorldInverse.toArray().join(','));

    renderer.render(scene, camera);

    window.requestAnimationFrame(_recurse);
  };
  _recurse();
};

console.log('node boot html end');
