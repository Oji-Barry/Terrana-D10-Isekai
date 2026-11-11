var gridBounds = new THREE.Box3(
  new THREE.Vector3(-9, -6, -6),   // Terrana: a wide, shallow box seen head-on, like the Windows original
  new THREE.Vector3(9, 6, 6)
);
var nodes = {};
function setAt(position, value) {
  nodes["(" + position.x + ", " + position.y + ", " + position.z + ")"] = value;
}
function getAt(position, value) {
  return nodes["(" + position.x + ", " + position.y + ", " + position.z + ")"];
}
function clearGrid() {
  nodes = {};
}

var textures = {};
var Pipe = function(scene, options) {
  var self = this;
  var pipeRadius = 0.3;   // Terrana: thicker pipes, like the original
  var ballJointRadius = pipeRadius * 1.6;
  var bendRadius = 0.42;   // how wide an elbow curves
  var teapotSize = ballJointRadius;

  self.currentPosition = randomIntegerVector3WithinBox(gridBounds);
  self.positions = [self.currentPosition];
  self.object3d = new THREE.Object3D();
  scene.add(self.object3d);
  if (options.texturePath) {
    self.material = new THREE.MeshLambertMaterial({
      map: textures[options.texturePath],
    });
  } else {
    // Terrana: the original's bold, plain colors
    var color = chooseFrom([0xd81e1e, 0x1ec41e, 0x2244e8, 0xe8d21e, 0x1ec8d8, 0xd81ed8, 0xe8e8e8, 0xe8841e]);
    var emissive = new THREE.Color(color).multiplyScalar(0.06);
    self.material = new THREE.MeshPhongMaterial({
      specular: 0xffffff,
      color: color,
      emissive: emissive,
      shininess: 55,
    });
  }
  var makeCylinderBetweenPoints = function(fromPoint, toPoint, material) {
    var deltaVector = new THREE.Vector3().subVectors(toPoint, fromPoint);
    var arrow = new THREE.ArrowHelper(
      deltaVector.clone().normalize(),
      fromPoint
    );
    var geometry = new THREE.CylinderGeometry(
      pipeRadius,
      pipeRadius,
      deltaVector.length(),
      10,
      4,
      true
    );
    var mesh = new THREE.Mesh(geometry, material);

    mesh.rotation.setFromQuaternion(arrow.quaternion);
    mesh.position.addVectors(fromPoint, deltaVector.multiplyScalar(0.5));
    mesh.updateMatrix();

    self.object3d.add(mesh);
    return mesh;
  };
  // Terrana: a real curved elbow (a quarter of a ring) from the end of one straight run to the start of the next
  var makeBend = function(corner, inDir, outDir) {
    var center = corner.clone().addScaledVector(inDir, -bendRadius).addScaledVector(outDir, bendRadius);
    var xAxis = outDir.clone().negate(), yAxis = inDir.clone(), zAxis = new THREE.Vector3().crossVectors(xAxis, yAxis);
    var torus = new THREE.Mesh(new THREE.TorusGeometry(bendRadius, pipeRadius, 10, 10, Math.PI / 2), self.material);
    torus.matrixAutoUpdate = false;
    torus.matrix.makeBasis(xAxis, yAxis, zAxis).setPosition(center);
    self.object3d.add(torus);
  };
  var makeBallJoint = function(position) {
    var ball = new THREE.Mesh(
      new THREE.SphereGeometry(ballJointRadius, 8, 8),
      self.material
    );
    ball.position.copy(position);
    self.object3d.add(ball);
  };
  var makeTeapotJoint = function(position) {
    //var teapotTexture = textures[options.texturePath].clone();
    //teapotTexture.repeat.set(1, 1);

    // THREE.TeapotBufferGeometry = function ( size, segments, bottom, lid, body, fitLid, blinn )
    var teapot = new THREE.Mesh(
      new THREE.TeapotBufferGeometry(teapotSize, true, true, true, true, true),
      self.material
      //new THREE.MeshLambertMaterial({ map: teapotTexture })
    );
    teapot.position.copy(position);
    teapot.rotation.x = (Math.floor(random(0, 50)) * Math.PI) / 2;
    teapot.rotation.y = (Math.floor(random(0, 50)) * Math.PI) / 2;
    teapot.rotation.z = (Math.floor(random(0, 50)) * Math.PI) / 2;
    self.object3d.add(teapot);
  };
  var makeElbowJoint = function(fromPosition, toPosition, tangentVector) {
    // elbow
    // var r = 0.2;
    // elbow = new THREE.Mesh(
    //   new THREE.TorusGeometry(r, pipeRadius, 8, 8, Math.PI / 2),
    //   self.material
    // );
    // elbow.position.copy(fromPosition);
    // self.object3d.add(elbow);

    // "elball" (not a proper elbow)
    var elball = new THREE.Mesh(
      new THREE.SphereGeometry(pipeRadius, 8, 8),
      self.material
    );
    elball.position.copy(fromPosition);
    self.object3d.add(elball);

    // extrude an elbow joint

    // there's THREE.EllipseCurve... but that's 2D

    // function ArcCurve(scale) {
    //   THREE.Curve.call(this);
    //   this.scale = scale === undefined ? 1 : scale; // TODO: remove me probably
    // }

    // ArcCurve.prototype = Object.create(THREE.Curve.prototype);
    // ArcCurve.prototype.constructor = ArcCurve;

    // ArcCurve.prototype.getPoint = function(t) {
    //   function circ(t) {
    //     return Math.sqrt(1 - t * t);
    //   }

    //   var tx = t;
    //   var ty = circ(t);
    //   var tz = 0;

    //   return new THREE.Vector3(tx, ty, tz).multiplyScalar(this.scale);
    // };

    // var extrudePath = new ArcCurve(0.1);

    // var extrudePath = new THREE.CatmullRomCurve3([fromPosition, toPosition], false); // not enough to define the curve

    // var extrusionSegments = 100;
    // var radiusSegments = 10;
    // var radius = pipeRadius;
    // var tubeGeometry = new THREE.TubeBufferGeometry(
    //   extrudePath,
    //   extrusionSegments,
    //   radius,
    //   radiusSegments,
    //   false
    // );

    // var elbow = new THREE.Mesh(tubeGeometry, self.material);
    // elbow.position.copy(toPosition);
    // self.object3d.add(elbow);
  };

  // if (getAt(self.currentPosition)) {
  //   return; // TODO: find a position that's free
  // }
  setAt(self.currentPosition, self);

  makeBallJoint(self.currentPosition);

  self.stuck = 0;
  self.lastDir = null;
  self.lastSeg = null;      // the straight run still growing, so it can be cut short when the pipe turns
  self.lastSegStart = self.currentPosition.clone();
  self.update = function() {
    // Terrana: try straight on half the time, otherwise any free direction, so pipes wander until truly boxed in
    var dirs = [];
    "xyz".split("").forEach(function(axis) { [1, -1].forEach(function(sign) { var v = new THREE.Vector3(); v[axis] = sign; dirs.push(v); }); });
    shuffleArrayInPlace(dirs);
    if (self.lastDir && chance(1 / 2)) dirs.unshift(self.lastDir.clone());
    var directionVector = null, newPosition = null;
    for (var i = 0; i < dirs.length; i++) {
      var np = new THREE.Vector3().addVectors(self.currentPosition, dirs[i]);
      if (gridBounds.containsPoint(np) && !getAt(np)) { directionVector = dirs[i]; newPosition = np; break; }
    }
    if (!directionVector) { self.stuck++; return; }
    setAt(newPosition, self);
    var P = self.currentPosition, start = P;
    if (self.lastDir && !self.lastDir.equals(directionVector)) {
      if (chance(options.teapotChance)) {
        makeTeapotJoint(P);
      } else if (chance(options.ballJointChance)) {
        makeBallJoint(P);
      } else {
        // cut the last straight run short and curve round the corner
        if (self.lastSeg) {
          self.object3d.remove(self.lastSeg);
          var end = P.clone().addScaledVector(self.lastDir, -bendRadius);
          if (end.distanceTo(self.lastSegStart) > 0.01) makeCylinderBetweenPoints(self.lastSegStart, end, self.material);
        }
        makeBend(P, self.lastDir, directionVector);
        start = P.clone().addScaledVector(directionVector, bendRadius);
      }
      self.lastSegStart = start;
      self.lastSeg = makeCylinderBetweenPoints(start, newPosition, self.material);
    } else {
      // keep the straight run as one piece, so a later turn can trim it
      if (self.lastSeg) self.object3d.remove(self.lastSeg);
      else self.lastSegStart = P;
      self.lastSeg = makeCylinderBetweenPoints(self.lastSegStart, newPosition, self.material);
    }
    self.lastDir = directionVector.clone();
    self.currentPosition = newPosition;
    self.positions.push(newPosition);
  };
};

var JOINTS_ELBOW = "elbow";
var JOINTS_BALL = "ball";
var JOINTS_MIXED = "mixed";
var JOINTS_CYCLE = "cycle";

var jointsCycleArray = [JOINTS_ELBOW, JOINTS_BALL, JOINTS_MIXED];
var jointsCycleIndex = 0;

var jointTypeSelect = document.getElementById("joint-types");

var pipes = [];
var options = {
  multiple: false,   // Terrana: one pipe at a time, like the original
  texturePath: null,
  joints: jointTypeSelect.value,
  interval: [70, 90], // range of seconds between fade-outs... not necessarily anything like how the original works
};
jointTypeSelect.addEventListener("change", function() {
  options.joints = jointTypeSelect.value;
});

var canvasContainer = document.getElementById("canvas-container");

// 2d canvas for dissolve effect
var canvas2d = document.getElementById("canvas-2d");
var ctx2d = canvas2d.getContext("2d");

// renderer
var canvasWebGL = document.getElementById("canvas-webgl");
var renderer = new THREE.WebGLRenderer({
  alpha: true,
  antialias: true,
  canvas: canvasWebGL,
});
renderer.setSize(window.innerWidth, window.innerHeight);

// camera
var camera = new THREE.PerspectiveCamera(
  45,
  window.innerWidth / window.innerHeight,
  1,
  100000
);

// controls
var controls = new THREE.OrbitControls(camera, renderer.domElement);
controls.enabled = false;
// controls.autoRotate = true;

// scene
var scene = new THREE.Scene();

// lighting
var ambientLight = new THREE.AmbientLight(0x262626);
scene.add(ambientLight);

var directionalLightL = new THREE.DirectionalLight(0xffffff, 0.9);
directionalLightL.position.set(-1.2, 1.5, 0.5);
scene.add(directionalLightL);
var directionalLightR = new THREE.DirectionalLight(0xffffff, 0.25);   // Terrana: a soft fill light from the front right
directionalLightR.position.set(1, -0.3, 1);
scene.add(directionalLightR);

// dissolve transition effect

var dissolveRects = [];
var dissolveRectsIndex = -1;
var dissolveRectsPerRow = 50;
var dissolveRectsPerColumn = 50;
var dissolveTransitionSeconds = 2;
var dissolveTransitionFrames = dissolveTransitionSeconds * 60;
var dissolveEndCallback;

function dissolve(seconds, endCallback) {
  // TODO: determine rect sizes better and simplify
  // (silly approximation of squares of a particular size:)
  dissolveRectsPerRow = Math.ceil(window.innerWidth / 20);
  dissolveRectsPerColumn = Math.ceil(window.innerHeight / 20);

  dissolveRects = new Array(dissolveRectsPerRow * dissolveRectsPerColumn)
    .fill(null)
    .map(function(_null, index) {
      return {
        x: index % dissolveRectsPerRow,
        y: Math.floor(index / dissolveRectsPerRow),
      };
    });
  shuffleArrayInPlace(dissolveRects);
  dissolveRectsIndex = 0;
  dissolveTransitionSeconds = seconds;
  dissolveTransitionFrames = dissolveTransitionSeconds * 60;
  dissolveEndCallback = endCallback;
}
function finishDissolve() {
  dissolveEndCallback();
  dissolveRects = [];
  dissolveRectsIndex = -1;
  ctx2d.clearRect(0, 0, canvas2d.width, canvas2d.height);
}

var clearing = false;
var clearTID = -1;
function clear(fast) {
  clearTimeout(clearTID);
  clearTID = setTimeout(
    clear,
    random(options.interval[0], options.interval[1]) * 1000
  );
  if (!clearing) {
    clearing = true;
    var fadeOutTime = fast ? 0.2 : 2;
    dissolve(fadeOutTime, reset);
  }
}
clearTID = setTimeout(
  clear,
  random(options.interval[0], options.interval[1]) * 1000
);

function reset() {
  renderer.clear();
  for (var i = 0; i < pipes.length; i++) {
    scene.remove(pipes[i].object3d);
  }
  pipes = [];
  clearGrid();
  look();
  clearing = false;
}

// this function is executed on each animation frame
function animate() {
  controls.update();
  if (options.texturePath && !textures[options.texturePath]) {
    var texture = THREE.ImageUtils.loadTexture(options.texturePath);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(2, 2);
    textures[options.texturePath] = texture;
  }
  // update (Terrana: 18 pipe steps a second, times window.pipeSpeed, set by the site's Speed menu)
  var nowT = performance.now(), stepDt = Math.min(0.1, (nowT - (window.__pipeT || nowT)) / 1000) || 1 / 60;
  window.__pipeT = nowT;
  window.__pipeAcc = (window.__pipeAcc || 0) + stepDt * 18 * (window.pipeSpeed == null ? 1 : window.pipeSpeed);
  var steps = Math.min(8, Math.floor(window.__pipeAcc));
  window.__pipeAcc -= steps;
  for (var s = 0; s < steps; s++) {
    for (var i = 0; i < pipes.length; i++) {
      pipes[i].update(scene);
    }
  }
  // Terrana: like the original, a new pipe starts whenever the growing ones are boxed in,
  // and once enough pipes have filled the space the screen dissolves and starts over
  var allStuck = pipes.length > 0 && pipes.every(function(pp) { return pp.stuck > 2; });
  if (allStuck && !clearing) {
    if (pipes.length >= 9) clear();
    else pipes.push(new Pipe(scene, pipes[0].pipeOptions));
  }
  if (pipes.length === 0) {
    var jointType = options.joints;
    if (options.joints === JOINTS_CYCLE) {
      jointType = jointsCycleArray[jointsCycleIndex++];
    }
    var pipeOptions = {
      teapotChance: 1 / 200, // 1 / 1000 in the original
      ballJointChance:
        jointType === JOINTS_BALL ? 1 : jointType === JOINTS_MIXED ? 1 / 3 : 0,
      texturePath: options.texturePath,
    };
    if (chance(1 / 20)) {
      pipeOptions.teapotChance = 1 / 20; // why not? :)
      pipeOptions.texturePath = "images/textures/candycane.png";
      // TODO: DRY
      if (!textures[pipeOptions.texturePath]) {
        var texture = THREE.ImageUtils.loadTexture(pipeOptions.texturePath);
        texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
        texture.repeat.set(2, 2);
        textures[pipeOptions.texturePath] = texture;
      }
    }
    // TODO: create new pipes over time?
    for (var i = 0; i < 1 + options.multiple * (1 + chance(1 / 10)); i++) {
      var np2 = new Pipe(scene, pipeOptions); np2.pipeOptions = pipeOptions; pipes.push(np2);
    }
  }

  if (!clearing) {
    renderer.render(scene, camera);
  }

  if (
    canvas2d.width !== window.innerWidth ||
    canvas2d.height !== window.innerHeight
  ) {
    canvas2d.width = window.innerWidth;
    canvas2d.height = window.innerHeight;
    // TODO: DRY!
    // actually: TODO: make the 2d canvas really low resolution, and stretch it with CSS, with pixelated interpolation
    if (dissolveRectsIndex > -1) {
      for (var i = 0; i < dissolveRectsIndex; i++) {
        var rect = dissolveRects[i];
        // TODO: could precompute rect in screen space, or at least make this clearer with "xIndex"/"yIndex"
        var rectWidth = innerWidth / dissolveRectsPerRow;
        var rectHeight = innerHeight / dissolveRectsPerColumn;
        ctx2d.fillStyle = "black";
        ctx2d.fillRect(
          Math.floor(rect.x * rectWidth),
          Math.floor(rect.y * rectHeight),
          Math.ceil(rectWidth),
          Math.ceil(rectHeight)
        );
      }
    }
  }
  if (dissolveRectsIndex > -1) {
    // TODO: calibrate based on time transition is actually taking
    var rectsAtATime = Math.floor(
      dissolveRects.length / dissolveTransitionFrames
    );
    for (
      var i = 0;
      i < rectsAtATime && dissolveRectsIndex < dissolveRects.length;
      i++
    ) {
      var rect = dissolveRects[dissolveRectsIndex];
      // TODO: could precompute rect in screen space, or at least make this clearer with "xIndex"/"yIndex"
      var rectWidth = innerWidth / dissolveRectsPerRow;
      var rectHeight = innerHeight / dissolveRectsPerColumn;
      ctx2d.fillStyle = "black";
      ctx2d.fillRect(
        Math.floor(rect.x * rectWidth),
        Math.floor(rect.y * rectHeight),
        Math.ceil(rectWidth),
        Math.ceil(rectHeight)
      );
      dissolveRectsIndex += 1;
    }
    if (dissolveRectsIndex === dissolveRects.length) {
      finishDissolve();
    }
  }

  requestAnimationFrame(animate);
}

function look() {
  // TODO: never don't change the view (except maybe while clearing)
  if (true) {
    // head-on view (Terrana: always, like the original)

    camera.position.set(0, 0, 19);
  } else {
    // random view

    var vector = new THREE.Vector3(14, 0, 0);

    var axis = new THREE.Vector3(random(-1, 1), random(-1, 1), random(-1, 1));
    var angle = Math.PI / 2;
    var matrix = new THREE.Matrix4().makeRotationAxis(axis, angle);

    vector.applyMatrix4(matrix);
    camera.position.copy(vector);
  }
  var center = new THREE.Vector3(0, 0, 0);
  camera.lookAt(center);
  // camera.updateProjectionMatrix(); // maybe?
  controls.update();
}
look();

addEventListener(
  "resize",
  function() {
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  },
  false
);

canvasContainer.addEventListener("mousedown", function(e) {
  e.preventDefault();
  if (!controls.enabled) {
    if (e.button) {
      clear(true);
    } else {
      look();
    }
  }
  window.getSelection().removeAllRanges();
  document.activeElement.blur();
});

canvasContainer.addEventListener(
  "contextmenu",
  function(e) {
    e.preventDefault();
  },
  false
);

var fullscreenButton = document.getElementById("fullscreen-button");
fullscreenButton.addEventListener(
  "click",
  function(e) {
    if (canvasContainer.requestFullscreen) {
      // W3C API
      canvasContainer.requestFullscreen();
    } else if (canvasContainer.mozRequestFullScreen) {
      // Mozilla current API
      canvasContainer.mozRequestFullScreen();
    } else if (canvasContainer.webkitRequestFullScreen) {
      // Webkit current API
      canvasContainer.webkitRequestFullScreen();
    }
  },
  false
);

var toggleControlButton = document.getElementById("toggle-controls");
toggleControlButton.addEventListener(
  "click",
  function(e) {
    controls.enabled = !controls.enabled;
    showElementsIf(".normal-controls-enabled", !controls.enabled);
    showElementsIf(".orbit-controls-enabled", controls.enabled);
  },
  false
);

// parse URL parameters
// support e.g. <iframe src="https://1j01.github.io/pipes/#{%22hideUI%22:true}"/>
function updateFromParametersInURL() {
  var paramsJSON = decodeURIComponent(location.hash.replace(/^#/, ""));
  if (paramsJSON) {
    try {
      var params = JSON.parse(paramsJSON);
      if (typeof params !== "object") {
        alert("Invalid URL parameter JSON: top level value must be an object");
        params = null;
      }
    } catch (error) {
      alert("Invalid URL parameter JSON syntax\n\n" + error + "\n\nRecieved:\n" + paramsJSON);
    }
  }
  params = params || {};

  // update based on the parameters
  // TODO: support more options
  showElementsIf(".ui-container", !params.hideUI);
}

updateFromParametersInURL();
window.addEventListener("hashchange", updateFromParametersInURL);

// start animation
animate();

/**************\
|boring helpers|
\**************/
function random(x1, x2) {
  return Math.random() * (x2 - x1) + x1;
}
function randomInteger(x1, x2) {
  return Math.round(random(x1, x2));
}
function chance(value) {
  return Math.random() < value;
}
function chooseFrom(values) {
  return values[Math.floor(Math.random() * values.length)];
}
function shuffleArrayInPlace(array) {
  for (var i = array.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var temp = array[i];
    array[i] = array[j];
    array[j] = temp;
  }
}
function randomIntegerVector3WithinBox(box) {
  return new THREE.Vector3(
    randomInteger(box.min.x, box.max.x),
    randomInteger(box.min.y, box.max.y),
    randomInteger(box.min.z, box.max.z)
  );
}
function showElementsIf(selector, condition) {
  Array.from(document.querySelectorAll(selector)).forEach(function(el) {
    if (condition) {
      el.removeAttribute("hidden");
    } else {
      el.setAttribute("hidden", "hidden");
    }
  });
}
