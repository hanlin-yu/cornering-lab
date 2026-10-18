(function (global) {
  'use strict';

  if (!global.THREE) {
    return;
  }

  var THREE = global.THREE;
  if (THREE.ColorManagement) {
    THREE.ColorManagement.legacyMode = false;
  }
  var UP = new THREE.Vector3(0, 1, 0);
  var TMP_A = new THREE.Vector3();
  var TMP_B = new THREE.Vector3();
  var TMP_C = new THREE.Vector3();
  var TMP_DIR = new THREE.Vector3();
  var TMP_QUAT = new THREE.Quaternion();

  var DIM = Object.freeze({
    wheelbase: 2.570,
    trackFront: 1.520,
    trackRear: 1.540,
    wheelRadius: 0.3126,
    wheelWidth: 0.215,
    tyreVerticalRate: 262593,
    rollCenterY: 0.175,
    defaultCgHeight: 0.4226,
    defaultFrontWeight: 0.575
  });

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function damp(current, target, lambda, dt) {
    return current + (target - current) * (1 - Math.exp(-lambda * dt));
  }

  function makeShadowTexture(strength) {
    var canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    var ctx = canvas.getContext('2d');
    var gradient = ctx.createRadialGradient(128, 128, 4, 128, 128, 124);
    gradient.addColorStop(0, 'rgba(0, 0, 0, ' + strength + ')');
    gradient.addColorStop(0.38, 'rgba(0, 0, 0, ' + strength * 0.72 + ')');
    gradient.addColorStop(0.72, 'rgba(0, 0, 0, ' + strength * 0.22 + ')');
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 256, 256);
    var texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    return texture;
  }

  function createEnvironment(renderer) {
    var canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 256;
    var ctx = canvas.getContext('2d');
    var gradient = ctx.createLinearGradient(0, 0, 0, 256);
    gradient.addColorStop(0, '#9cb9c0');
    gradient.addColorStop(0.26, '#4b6872');
    gradient.addColorStop(0.54, '#111e24');
    gradient.addColorStop(0.76, '#080e12');
    gradient.addColorStop(1, '#020507');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 512, 256);

    var glow = ctx.createRadialGradient(340, 55, 4, 340, 55, 130);
    glow.addColorStop(0, 'rgba(255, 243, 211, 0.66)');
    glow.addColorStop(0.2, 'rgba(255, 226, 172, 0.22)');
    glow.addColorStop(1, 'rgba(255, 226, 172, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, 512, 256);

    var cyan = ctx.createRadialGradient(110, 130, 4, 110, 130, 140);
    cyan.addColorStop(0, 'rgba(85, 220, 215, 0.26)');
    cyan.addColorStop(1, 'rgba(85, 220, 215, 0)');
    ctx.fillStyle = cyan;
    ctx.fillRect(0, 0, 512, 256);

    var texture = new THREE.CanvasTexture(canvas);
    texture.mapping = THREE.EquirectangularReflectionMapping;
    if (THREE.sRGBEncoding) {
      texture.encoding = THREE.sRGBEncoding;
    }
    var pmrem = new THREE.PMREMGenerator(renderer);
    var env = pmrem.fromEquirectangular(texture).texture;
    texture.dispose();
    pmrem.dispose();
    return env;
  }

  function createRod(radius, material, segments) {
    var geometry = new THREE.CylinderGeometry(radius, radius, 1, segments || 10, 1);
    geometry.translate(0, 0.5, 0);
    var mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    return mesh;
  }

  function placeRod(mesh, start, end) {
    TMP_DIR.subVectors(end, start);
    var length = TMP_DIR.length();
    if (length < 0.00001) {
      mesh.visible = false;
      return;
    }
    mesh.visible = true;
    mesh.position.copy(start);
    TMP_QUAT.setFromUnitVectors(UP, TMP_DIR.normalize());
    mesh.quaternion.copy(TMP_QUAT);
    mesh.scale.set(1, length, 1);
  }

  function createHelixGeometry() {
    var points = [];
    var segments = 210;
    var coils = 7;
    var radius = 0.058;
    for (var i = 0; i <= segments; i += 1) {
      var t = i / segments;
      var angle = t * Math.PI * 2 * coils;
      points.push(new THREE.Vector3(
        Math.cos(angle) * radius,
        t,
        Math.sin(angle) * radius
      ));
    }
    var curve = new THREE.CatmullRomCurve3(points);
    return new THREE.TubeGeometry(curve, segments, 0.0068, 6, false);
  }

  function setObjectBetween(object, start, end) {
    TMP_DIR.subVectors(end, start);
    var length = TMP_DIR.length();
    if (length < 0.00001) {
      object.visible = false;
      return length;
    }
    object.visible = true;
    object.position.copy(start);
    TMP_QUAT.setFromUnitVectors(UP, TMP_DIR.normalize());
    object.quaternion.copy(TMP_QUAT);
    return length;
  }

  function createCylinderDisc(radius, height, material, radialSegments) {
    var geometry = new THREE.CylinderGeometry(radius, radius, height, radialSegments || 24);
    var mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    return mesh;
  }

  function CorneringChassisScene(container, options) {
    if (!(this instanceof CorneringChassisScene)) {
      return new CorneringChassisScene(container, options);
    }

    this.container = container;
    this.options = options || {};
    this.ready = false;
    this.disposed = false;
    this.lastTime = performance.now();
    this.elapsed = 0;
    this.pointers = new Map();
    this.pinchDistance = 0;

    var viewportWidth = Math.max(1, container.clientWidth);
    var viewportHeight = Math.max(1, container.clientHeight);

    try {
      this.renderer = new THREE.WebGLRenderer({
        alpha: true,
        antialias: true,
        powerPreference: 'high-performance'
      });
    } catch (error) {
      throw new Error('WEBGL_UNAVAILABLE');
    }

    this.renderer.setPixelRatio(Math.min(global.devicePixelRatio || 1, 2));
    this.renderer.setSize(viewportWidth, viewportHeight, false);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputEncoding = THREE.sRGBEncoding;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.04;
    this.renderer.domElement.setAttribute('aria-label', '可旋转的 GT86 三维底盘示意');
    this.renderer.domElement.setAttribute('role', 'img');
    container.insertBefore(this.renderer.domElement, container.firstChild);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(35, viewportWidth / viewportHeight, 0.05, 60);
    this.cameraTarget = new THREE.Vector3(0, 0.39, 0);

    this.orbit = {
      radius: 6.5,
      theta: 0.73,
      phi: 1.1,
      targetRadius: 6.5,
      targetTheta: 0.73,
      targetPhi: 1.1
    };

    this.visual = {
      roll: 0,
      pitch: 0,
      steer: 0,
      lateralG: 0.85,
      longitudinalG: 0,
      loads: {
        FL: 0,
        FR: 0,
        RL: 0,
        RR: 0
      }
    };

    this.target = {
      roll: 0,
      pitch: 0,
      steer: 0,
      lateralG: 0.85,
      longitudinalG: 0,
      loads: {
        FL: 0,
        FR: 0,
        RL: 0,
        RR: 0
      }
    };

    this.corners = {};
    this.hardpoints = {};
    this.hubs = {};
    this.links = [];
    this.springs = [];
    this.wheelLabels = Array.prototype.slice.call(container.querySelectorAll('[data-wheel-label]'));
    this.cogLabel = container.querySelector('[data-cog-label]');
    this.gLabel = container.querySelector('[data-g-label]');
    this.currentGArrowLength = 1.3;
    this.tyreVerticalRate = DIM.tyreVerticalRate;
    this.loading = container.querySelector('.scene-loading');
    this.frontAxleZ = DIM.wheelbase / 2;
    this.rearAxleZ = -DIM.wheelbase / 2;

    this.buildLights();
    this.buildGround();
    this.buildChassis();
    this.buildWheels();
    this.buildSuspension();
    this.buildArb();
    this.buildCogAndG();
    this.bindControls();

    this.resizeObserver = new ResizeObserver(this.resize.bind(this));
    this.resizeObserver.observe(container);

    this.resize();
    this.animate = this.animate.bind(this);
    this.animationFrame = global.requestAnimationFrame(this.animate);
  }

  CorneringChassisScene.prototype.buildLights = function () {
    this.scene.environment = createEnvironment(this.renderer);

    var hemi = new THREE.HemisphereLight(0xb4d9e5, 0x030608, 1.45);
    this.scene.add(hemi);

    var key = new THREE.DirectionalLight(0xf2f8ff, 5.1);
    key.position.set(4.5, 7, 5.5);
    this.scene.add(key);

    var cyan = new THREE.DirectionalLight(0x6ae7e0, 2.05);
    cyan.position.set(-5.5, 2.7, 2.2);
    this.scene.add(cyan);

    var amber = new THREE.DirectionalLight(0xffb266, 1.2);
    amber.position.set(4.4, 2.4, -5.2);
    this.scene.add(amber);

    var top = new THREE.PointLight(0xedf9ff, 0.48, 10, 2);
    top.position.set(0, 4.2, 0);
    this.scene.add(top);
  };

  CorneringChassisScene.prototype.buildGround = function () {
    var groundMaterial = new THREE.MeshBasicMaterial({
      color: 0x060c10,
      transparent: true,
      opacity: 0.16,
      depthWrite: false
    });
    var ground = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.018;
    this.scene.add(ground);

    var grid = new THREE.GridHelper(18, 36, 0x36535e, 0x172a33);
    grid.position.y = 0.001;
    grid.material.transparent = true;
    grid.material.opacity = 0.52;
    grid.material.depthWrite = false;
    this.scene.add(grid);

    var outerRingPoints = [];
    for (var i = 0; i <= 160; i += 1) {
      var angle = (i / 160) * Math.PI * 2;
      outerRingPoints.push(new THREE.Vector3(Math.cos(angle) * 4.4, 0.004, Math.sin(angle) * 4.4));
    }
    var ringGeometry = new THREE.BufferGeometry().setFromPoints(outerRingPoints);
    var ringMaterial = new THREE.LineDashedMaterial({
      color: 0x34515b,
      transparent: true,
      opacity: 0.23,
      dashSize: 0.055,
      gapSize: 0.12
    });
    var ring = new THREE.Line(ringGeometry, ringMaterial);
    ring.computeLineDistances();
    this.scene.add(ring);

    var softShadow = new THREE.Mesh(
      new THREE.PlaneGeometry(4.8, 6.2),
      new THREE.MeshBasicMaterial({
        map: makeShadowTexture(0.55),
        transparent: true,
        opacity: 0.7,
        depthWrite: false
      })
    );
    softShadow.rotation.x = -Math.PI / 2;
    softShadow.position.y = 0.002;
    this.scene.add(softShadow);

    this.contactShadowTexture = makeShadowTexture(0.52);
    this.contactShadowMaterial = new THREE.MeshBasicMaterial({
      map: this.contactShadowTexture,
      transparent: true,
      opacity: 0.68,
      depthWrite: false
    });
  };

  CorneringChassisScene.prototype.addChassisTube = function (a, b, radius, material) {
    var mesh = createRod(radius, material, 8);
    mesh.visible = true;
    var localA = new THREE.Vector3(a[0], a[1] - DIM.rollCenterY, a[2]);
    var localB = new THREE.Vector3(b[0], b[1] - DIM.rollCenterY, b[2]);
    placeRod(mesh, localA, localB);
    this.body.add(mesh);
    return mesh;
  };

  CorneringChassisScene.prototype.addHardpoint = function (name, x, y, z, showJoint) {
    var anchor = new THREE.Object3D();
    anchor.position.set(x, y - DIM.rollCenterY, z);
    this.body.add(anchor);
    this.hardpoints[name] = anchor;

    if (showJoint !== false) {
      var joint = new THREE.Mesh(
        new THREE.SphereGeometry(0.022, 12, 8),
        this.jointMaterial
      );
      joint.position.copy(anchor.position);
      this.body.add(joint);
    }
    return anchor;
  };

  CorneringChassisScene.prototype.buildChassis = function () {
    var frameMaterial = new THREE.MeshStandardMaterial({
      color: 0x263740,
      roughness: 0.4,
      metalness: 0.72,
      envMapIntensity: 0.66
    });
    var frameAccentMaterial = new THREE.MeshStandardMaterial({
      color: 0x43565f,
      roughness: 0.3,
      metalness: 0.78,
      envMapIntensity: 0.75
    });
    this.frameAccentMaterial = frameAccentMaterial;
    var floorMaterial = new THREE.MeshStandardMaterial({
      color: 0x061015,
      roughness: 0.9,
      metalness: 0.12,
      envMapIntensity: 0.1,
      transparent: true,
      opacity: 0.84,
      side: THREE.DoubleSide
    });
    this.jointMaterial = new THREE.MeshStandardMaterial({
      color: 0x89979e,
      metalness: 0.84,
      roughness: 0.3,
      envMapIntensity: 0.82
    });
    this.armMaterial = new THREE.MeshStandardMaterial({
      color: 0x98a6ac,
      roughness: 0.27,
      metalness: 0.86,
      envMapIntensity: 0.86
    });
    this.damperMaterial = new THREE.MeshStandardMaterial({
      color: 0x58666d,
      roughness: 0.24,
      metalness: 0.9,
      envMapIntensity: 0.86
    });
    this.springMaterial = new THREE.MeshBasicMaterial({
      color: 0x50e5de,
      toneMapped: false
    });
    this.arbMaterial = new THREE.MeshBasicMaterial({
      color: 0xf0b05c,
      toneMapped: false
    });
    this.ringMaterial = new THREE.MeshStandardMaterial({
      color: 0x9aa7ad,
      roughness: 0.3,
      metalness: 0.9,
      envMapIntensity: 0.84
    });

    this.body = new THREE.Group();
    this.body.position.y = DIM.rollCenterY;
    this.scene.add(this.body);

    var rear = -1.61;
    var front = 1.61;
    var lowerY = 0.24;
    var upperY = 0.49;
    var halfFrame = 0.44;

    // Floor pan and central tunnel.
    var floor = new THREE.Mesh(new THREE.BoxGeometry(0.94, 0.014, 2.86), floorMaterial);
    floor.position.set(0, 0.205 - DIM.rollCenterY, -0.015);
    this.body.add(floor);

    var tunnel = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.16, 1.72), frameMaterial);
    tunnel.position.set(0, 0.31 - DIM.rollCenterY, -0.02);
    this.body.add(tunnel);

    // Main longitudinal rails.
    [-1, 1].forEach(function (side) {
      this.addChassisTube(
        [side * halfFrame, lowerY, rear],
        [side * halfFrame, lowerY, front],
        0.024,
        frameAccentMaterial
      );
      this.addChassisTube(
        [side * halfFrame, upperY, -0.56],
        [side * halfFrame, upperY, 0.83],
        0.017,
        frameMaterial
      );
      this.addChassisTube(
        [side * halfFrame, lowerY, rear],
        [side * halfFrame, upperY, -0.56],
        0.016,
        frameMaterial
      );
      this.addChassisTube(
        [side * halfFrame, lowerY, front],
        [side * halfFrame, upperY, 0.83],
        0.016,
        frameMaterial
      );
    }, this);

    // Lower cross members.
    [rear, -0.52, 0.18, 0.76, front].forEach(function (z) {
      this.addChassisTube([-halfFrame, lowerY, z], [halfFrame, lowerY, z], 0.014, frameMaterial);
    }, this);

    // Upper cockpit rails and firewall bracing.
    this.addChassisTube([-halfFrame, upperY, -0.56], [halfFrame, upperY, -0.56], 0.014, frameMaterial);
    this.addChassisTube([-halfFrame, upperY, 0.83], [halfFrame, upperY, 0.83], 0.014, frameMaterial);
    this.addChassisTube([-0.44, 0.28, 0.62], [0.44, 0.6, 0.62], 0.011, frameMaterial);
    this.addChassisTube([0.44, 0.28, 0.62], [-0.44, 0.6, 0.62], 0.011, frameMaterial);

    // Front and rear subframes.
    [-1, 1].forEach(function (side) {
      this.addChassisTube([side * 0.33, 0.27, 1.42], [side * 0.44, lowerY, 1.12], 0.015, frameMaterial);
      this.addChassisTube([side * 0.33, 0.27, 1.42], [side * 0.44, 0.46, 1.48], 0.013, frameMaterial);
      this.addChassisTube([side * 0.33, 0.27, -1.37], [side * 0.44, lowerY, -1.13], 0.015, frameMaterial);
      this.addChassisTube([side * 0.33, 0.27, -1.37], [side * 0.44, 0.46, -1.48], 0.013, frameMaterial);
    }, this);
    this.addChassisTube([-0.53, 0.41, 1.83], [0.53, 0.41, 1.83], 0.019, frameMaterial);
    this.addChassisTube([-0.53, 0.39, -1.83], [0.53, 0.39, -1.83], 0.019, frameMaterial);
    this.addChassisTube([0, 0.28, 1.42], [0, 0.28, 1.83], 0.012, frameMaterial);

    // Shock towers.
    [-1, 1].forEach(function (side) {
      this.addChassisTube([side * 0.50, 0.26, this.frontAxleZ + 0.13], [side * 0.50, 0.84, this.frontAxleZ + 0.03], 0.017, frameMaterial);
      this.addChassisTube([side * 0.50, 0.26, this.frontAxleZ - 0.16], [side * 0.50, 0.84, this.frontAxleZ + 0.03], 0.017, frameMaterial);
      this.addChassisTube([side * 0.50, 0.84, this.frontAxleZ + 0.03], [side * 0.44, upperY, 0.80], 0.012, frameMaterial);
      this.addChassisTube([side * 0.50, 0.26, this.rearAxleZ + 0.14], [side * 0.50, 0.82, this.rearAxleZ + 0.03], 0.017, frameMaterial);
      this.addChassisTube([side * 0.50, 0.82, this.rearAxleZ + 0.03], [side * 0.44, 0.48, this.rearAxleZ - 0.24], 0.013, frameMaterial);
    }, this);

    // Roll hoop.
    this.addChassisTube([-0.43, 0.25, -0.31], [-0.36, 0.91, -0.43], 0.019, frameAccentMaterial);
    this.addChassisTube([0.43, 0.25, -0.31], [0.36, 0.91, -0.43], 0.019, frameAccentMaterial);
    this.addChassisTube([-0.36, 0.91, -0.43], [0.36, 0.91, -0.43], 0.018, frameAccentMaterial);
    this.addChassisTube([-0.36, 0.91, -0.43], [0, 0.64, 0.04], 0.012, frameMaterial);
    this.addChassisTube([0.36, 0.91, -0.43], [0, 0.64, 0.04], 0.012, frameMaterial);

    // Top mounts / visible joint seam plates.
    [-1, 1].forEach(function (side) {
      var frontPlate = new THREE.Mesh(new THREE.CylinderGeometry(0.077, 0.077, 0.012, 20), frameAccentMaterial);
      frontPlate.position.set(side * 0.50, 0.84 - DIM.rollCenterY, this.frontAxleZ + 0.03);
      this.body.add(frontPlate);
      var rearPlate = new THREE.Mesh(new THREE.CylinderGeometry(0.077, 0.077, 0.012, 20), frameAccentMaterial);
      rearPlate.position.set(side * 0.50, 0.82 - DIM.rollCenterY, this.rearAxleZ + 0.03);
      this.body.add(rearPlate);
    }, this);

    this.buildHardpoints();
  };

  CorneringChassisScene.prototype.buildHardpoints = function () {
    var frontZ = this.frontAxleZ;
    var rearZ = this.rearAxleZ;

    [-1, 1].forEach(function (side) {
      var tag = side < 0 ? 'L' : 'R';

      this.addHardpoint('F' + tag + '.lcaFront', side * 0.34, 0.225, frontZ + 0.16);
      this.addHardpoint('F' + tag + '.lcaRear', side * 0.365, 0.225, frontZ - 0.17);
      this.addHardpoint('F' + tag + '.strutTop', side * 0.50, 0.84, frontZ + 0.03);
      this.addHardpoint('F' + tag + '.rack', side * 0.23, 0.305, frontZ - 0.38);

      this.addHardpoint('R' + tag + '.lcaFront', side * 0.325, 0.215, rearZ + 0.18);
      this.addHardpoint('R' + tag + '.lcaRear', side * 0.355, 0.215, rearZ - 0.18);
      this.addHardpoint('R' + tag + '.ucaFront', side * 0.325, 0.485, rearZ + 0.15);
      this.addHardpoint('R' + tag + '.ucaRear', side * 0.355, 0.485, rearZ - 0.16);
      this.addHardpoint('R' + tag + '.springTop', side * 0.45, 0.81, rearZ + 0.04);
      this.addHardpoint('R' + tag + '.toeInner', side * 0.29, 0.315, rearZ + 0.23);
    }, this);

    // Steering rack.
    this.addChassisTube([-0.24, 0.305, frontZ - 0.38], [0.24, 0.305, frontZ - 0.38], 0.019, this.ringMaterial);
  };

  CorneringChassisScene.prototype.buildWheels = function () {
    var tireMaterial = new THREE.MeshStandardMaterial({
      color: 0x050708,
      roughness: 0.92,
      metalness: 0.03,
      envMapIntensity: 0.12
    });
    var tireSideMaterial = new THREE.MeshStandardMaterial({
      color: 0x0a0e11,
      roughness: 0.82,
      metalness: 0.08,
      envMapIntensity: 0.2
    });

    var rimMaterial = new THREE.MeshStandardMaterial({
      color: 0x7f8b90,
      roughness: 0.26,
      metalness: 0.9,
      envMapIntensity: 0.88
    });
    var rimDarkMaterial = new THREE.MeshStandardMaterial({
      color: 0x131b20,
      roughness: 0.4,
      metalness: 0.82,
      envMapIntensity: 0.7
    });
    var brakeMaterial = new THREE.MeshStandardMaterial({
      color: 0x4a5256,
      roughness: 0.43,
      metalness: 0.82,
      envMapIntensity: 0.7
    });

    var configs = [
      { id: 'FL', side: -1, axle: 'front' },
      { id: 'FR', side: 1, axle: 'front' },
      { id: 'RL', side: -1, axle: 'rear' },
      { id: 'RR', side: 1, axle: 'rear' }
    ];

    configs.forEach(function (config) {
      var axleZ = config.axle === 'front' ? this.frontAxleZ : this.rearAxleZ;
      var track = config.axle === 'front' ? DIM.trackFront : DIM.trackRear;
      var root = new THREE.Group();
      root.position.set(config.side * track / 2, DIM.wheelRadius, axleZ);
      this.scene.add(root);

      var spin = new THREE.Group();
      root.add(spin);

      var tireGeometry = new THREE.CylinderGeometry(DIM.wheelRadius, DIM.wheelRadius, DIM.wheelWidth, 48, 1, false);
      tireGeometry.rotateZ(Math.PI / 2);
      var tire = new THREE.Mesh(tireGeometry, tireMaterial);
      spin.add(tire);

      var sidewallRing = new THREE.Mesh(
        new THREE.TorusGeometry(DIM.wheelRadius * 0.835, 0.012, 8, 40),
        tireSideMaterial
      );
      sidewallRing.rotation.y = Math.PI / 2;
      sidewallRing.position.x = config.side * (DIM.wheelWidth / 2 - 0.012);
      spin.add(sidewallRing);

      var rimGeometry = new THREE.CylinderGeometry(0.198, 0.198, DIM.wheelWidth + 0.004, 40, 1, false);
      rimGeometry.rotateZ(Math.PI / 2);
      var rim = new THREE.Mesh(rimGeometry, rimMaterial);
      spin.add(rim);

      var rimInset = new THREE.Mesh(
        new THREE.CylinderGeometry(0.171, 0.171, 0.012, 32),
        rimDarkMaterial
      );
      rimInset.rotation.z = Math.PI / 2;
      rimInset.position.x = config.side * (DIM.wheelWidth / 2 + 0.002);
      spin.add(rimInset);

      var hub = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.06, 20), rimMaterial);
      hub.rotation.z = Math.PI / 2;
      hub.position.x = config.side * (DIM.wheelWidth / 2 + 0.006);
      spin.add(hub);

      for (var spokeIndex = 0; spokeIndex < 5; spokeIndex += 1) {
        var spoke = new THREE.Mesh(
          new THREE.BoxGeometry(0.018, 0.31, 0.025),
          rimMaterial
        );
        spoke.position.set(config.side * (DIM.wheelWidth / 2 + 0.001), 0, 0);
        spoke.rotation.x = (spokeIndex / 5) * Math.PI * 2;
        spoke.translateY(0.083);
        spin.add(spoke);
      }

      var brakeDisc = new THREE.Mesh(
        new THREE.CylinderGeometry(0.17, 0.17, 0.019, 32),
        brakeMaterial
      );
      brakeDisc.rotation.z = Math.PI / 2;
      brakeDisc.position.x = -config.side * (DIM.wheelWidth / 2 - 0.035);
      root.add(brakeDisc);

      var caliper = new THREE.Mesh(
        new THREE.BoxGeometry(0.085, 0.11, 0.3),
        new THREE.MeshStandardMaterial({
          color: config.axle === 'front' ? 0x5e777e : 0x7a633e,
          roughness: 0.38,
          metalness: 0.65
        })
      );
      caliper.position.set(-config.side * (DIM.wheelWidth / 2 - 0.01), -0.06, 0.02);
      caliper.rotation.z = 0.06 * config.side;
      root.add(caliper);

      var shadow = new THREE.Mesh(
        new THREE.PlaneGeometry(0.86, 0.62),
        this.contactShadowMaterial
      );
      shadow.rotation.x = -Math.PI / 2;
      shadow.rotation.z = Math.PI / 2;
      shadow.position.set(config.side * track / 2, 0.0015, axleZ);
      shadow.renderOrder = 1;
      this.scene.add(shadow);

      this.corners[config.id] = {
        id: config.id,
        side: config.side,
        axle: config.axle,
        root: root,
        spin: spin,
        tire: tire,
        shadow: shadow,
        axleZ: axleZ,
        track: track
      };
    }, this);
  };

  CorneringChassisScene.prototype.setVehicleDimensions = function (profile) {
    if (!this.body || !profile) {
      return;
    }

    var baselineTrack = (DIM.trackFront + DIM.trackRear) / 2;
    var profileTrack = (profile.trackFrontM + profile.trackRearM) / 2;
    var scaleX = profileTrack / baselineTrack;
    var scaleZ = profile.wheelbaseM / DIM.wheelbase;

    this.body.scale.set(scaleX, 1, scaleZ);
    this.frontAxleZ = profile.wheelbaseM / 2;
    this.rearAxleZ = -this.frontAxleZ;

    var self = this;
    ['FL', 'FR', 'RL', 'RR'].forEach(function (wheelId) {
      var wheel = self.corners[wheelId];
      if (!wheel) {
        return;
      }
      var track = wheel.axle === 'front' ? profile.trackFrontM : profile.trackRearM;
      var axleZ = wheel.axle === 'front' ? self.frontAxleZ : self.rearAxleZ;
      wheel.track = track;
      wheel.axleZ = axleZ;
      wheel.root.position.x = wheel.side * track / 2;
      wheel.root.position.z = axleZ;
      if (wheel.shadow) {
        wheel.shadow.position.x = wheel.side * track / 2;
        wheel.shadow.position.z = axleZ;
      }
    });
  };

  CorneringChassisScene.prototype.addHubAnchor = function (wheelId, name, x, y, z) {
    var wheel = this.corners[wheelId];
    var anchor = new THREE.Object3D();
    anchor.position.set(x, y, z);
    wheel.root.add(anchor);
    this.hubs[wheelId + '.' + name] = anchor;

    var joint = new THREE.Mesh(
      new THREE.SphereGeometry(0.024, 12, 8),
      this.jointMaterial
    );
    joint.position.copy(anchor.position);
    wheel.root.add(joint);
    anchor.userData.joint = joint;
    return anchor;
  };

  CorneringChassisScene.prototype.addDynamicLink = function (a, b, radius, material) {
    var mesh = createRod(radius, material, 8);
    this.scene.add(mesh);
    this.links.push({ mesh: mesh, a: a, b: b });
    return mesh;
  };

  CorneringChassisScene.prototype.buildSuspension = function () {
    var springGeometry = createHelixGeometry();
    this.springGeometry = springGeometry;

    this.seatMaterialMesh = new THREE.MeshStandardMaterial({
      color: 0x68777d,
      roughness: 0.29,
      metalness: 0.9,
      envMapIntensity: 0.9
    });

    var wheelIds = ['FL', 'FR', 'RL', 'RR'];
    var self = this;

    wheelIds.forEach(function (wheelId) {
      var wheel = self.corners[wheelId];
      var side = wheel.side;
      var tag = side < 0 ? 'L' : 'R';
      var isFront = wheel.axle === 'front';

      var hubLower = self.addHubAnchor(wheelId, 'lower', -side * 0.125, -0.005, 0);
      var hubUpper = self.addHubAnchor(wheelId, 'upper', -side * 0.10, 0.14, 0);
      var hubSteer = self.addHubAnchor(wheelId, 'steer', -side * 0.085, 0.02, isFront ? -0.10 : 0.11);
      var springLower = self.addHubAnchor(wheelId, 'springLower', -side * (isFront ? 0.075 : 0.16), isFront ? 0.045 : 0.005, isFront ? 0.015 : 0.025);

      if (isFront) {
        self.addDynamicLink(self.hardpoints['F' + tag + '.lcaFront'], hubLower, 0.0135, self.armMaterial);
        self.addDynamicLink(self.hardpoints['F' + tag + '.lcaRear'], hubLower, 0.0135, self.armMaterial);
        self.addDynamicLink(self.hardpoints['F' + tag + '.rack'], hubSteer, 0.009, self.ringMaterial);
        self.addDynamicLink(hubLower, self.hardpoints['F' + tag + '.strutTop'], 0.015, self.damperMaterial);
      } else {
        self.addDynamicLink(self.hardpoints['R' + tag + '.lcaFront'], hubLower, 0.0135, self.armMaterial);
        self.addDynamicLink(self.hardpoints['R' + tag + '.lcaRear'], hubLower, 0.0135, self.armMaterial);
        self.addDynamicLink(self.hardpoints['R' + tag + '.ucaFront'], hubUpper, 0.0125, self.armMaterial);
        self.addDynamicLink(self.hardpoints['R' + tag + '.ucaRear'], hubUpper, 0.0125, self.armMaterial);
        self.addDynamicLink(self.hardpoints['R' + tag + '.toeInner'], hubSteer, 0.0085, self.ringMaterial);
      }

      var springTop = isFront
        ? self.hardpoints['F' + tag + '.strutTop']
        : self.hardpoints['R' + tag + '.springTop'];

      var springMesh = new THREE.Mesh(springGeometry, self.springMaterial);
      springMesh.frustumCulled = false;
      self.scene.add(springMesh);

      var seatTop = createCylinderDisc(0.081, 0.012, self.seatMaterialMesh, 20);
      var seatBottom = createCylinderDisc(0.081, 0.012, self.seatMaterialMesh, 20);
      self.scene.add(seatTop);
      self.scene.add(seatBottom);

      self.springs.push({
        lower: springLower,
        upper: springTop,
        mesh: springMesh,
        seatTop: seatTop,
        seatBottom: seatBottom
      });
    });
  };

  CorneringChassisScene.prototype.buildArb = function () {
    var self = this;
    var axles = [
      { id: 'front', z: this.frontAxleZ - 0.34, armDirection: 1 },
      { id: 'rear', z: this.rearAxleZ + 0.34, armDirection: -1 }
    ];

    this.arbArms = { front: {}, rear: {} };

    axles.forEach(function (axle) {
      var barY = 0.46;
      var barHalf = 0.56;
      var armLength = 0.34;

      self.addChassisTube(
        [-barHalf, barY, axle.z],
        [barHalf, barY, axle.z],
        0.0165,
        self.arbMaterial
      );

      [-0.38, 0.38].forEach(function (x) {
        self.addChassisTube(
          [x, barY - 0.015, axle.z],
          [x, barY + 0.08, axle.z],
          0.017,
          self.frameAccentMaterial || self.ringMaterial
        );
      });

      [-1, 1].forEach(function (side) {
        var tag = side < 0 ? 'L' : 'R';
        var pivot = new THREE.Group();
        pivot.position.set(side * barHalf, barY - DIM.rollCenterY, axle.z);
        self.body.add(pivot);

        var armGeometry = new THREE.CylinderGeometry(0.014, 0.014, 1, 8, 1);
        armGeometry.translate(0, 0.5, 0);
        var arm = new THREE.Mesh(armGeometry, self.arbMaterial);
        arm.frustumCulled = false;
        var armDir = new THREE.Vector3(0, 0, axle.armDirection * armLength);
        placeRod(arm, new THREE.Vector3(0, 0, 0), armDir);
        pivot.add(arm);

        var tip = new THREE.Object3D();
        tip.position.copy(armDir);
        pivot.add(tip);

        var wheelId = (axle.id === 'front' ? 'F' : 'R') + tag;
        var hubLower = self.hubs[wheelId + '.lower'];
        var dropLink = createRod(0.008, self.arbMaterial, 8);
        self.scene.add(dropLink);
        self.links.push({ mesh: dropLink, a: tip, b: hubLower });

        self.arbArms[axle.id][tag] = {
          pivot: pivot,
          tip: tip,
          side: side
        };
      });
    });
  };

  CorneringChassisScene.prototype.buildCogAndG = function () {
    this.cogAnchor = new THREE.Object3D();
    this.cogAnchor.position.set(
      0,
      DIM.defaultCgHeight - DIM.rollCenterY,
      (DIM.defaultFrontWeight - 0.5) * DIM.wheelbase
    );
    this.body.add(this.cogAnchor);
    this.cogWorld = new THREE.Vector3();

    var markerMaterial = new THREE.MeshBasicMaterial({
      color: 0xf2fbfd,
      toneMapped: false,
      transparent: true,
      opacity: 0.96,
      depthTest: false,
      depthWrite: false
    });
    var marker = new THREE.Mesh(new THREE.SphereGeometry(0.034, 16, 12), markerMaterial);
    marker.renderOrder = 40;
    this.cogAnchor.add(marker);

    var targetRingMaterial = new THREE.MeshBasicMaterial({
      color: 0xe9f8fa,
      toneMapped: false,
      transparent: true,
      opacity: 0.56,
      depthTest: false,
      depthWrite: false
    });
    var targetRing = new THREE.Mesh(new THREE.TorusGeometry(0.066, 0.005, 6, 30), targetRingMaterial);
    targetRing.rotation.x = Math.PI / 2;
    targetRing.renderOrder = 40;
    this.cogAnchor.add(targetRing);

    var plumbMaterial = new THREE.LineBasicMaterial({
      color: 0xdff2f5,
      transparent: true,
      opacity: 0.5,
      depthTest: false,
      depthWrite: false,
      toneMapped: false
    });
    var plumbGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 1, 0)
    ]);
    this.cogPlumb = new THREE.Line(plumbGeometry, plumbMaterial);
    this.cogPlumb.renderOrder = 32;
    this.scene.add(this.cogPlumb);

    var groundMaterial = new THREE.LineBasicMaterial({
      color: 0xdff2f5,
      transparent: true,
      opacity: 0.38,
      depthWrite: false,
      toneMapped: false
    });
    var groundPoints = [];
    for (var i = 0; i <= 40; i += 1) {
      var angle = (i / 40) * Math.PI * 2;
      groundPoints.push(new THREE.Vector3(Math.cos(angle) * 0.075, 0, Math.sin(angle) * 0.075));
    }
    this.cogGroundRing = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(groundPoints),
      groundMaterial
    );
    this.cogGroundRing.position.y = 0.012;
    this.cogGroundRing.renderOrder = 5;
    this.scene.add(this.cogGroundRing);

    this.gDirection = new THREE.Vector3(-1, 0, 0);
    this.gArrow = new THREE.ArrowHelper(
      this.gDirection,
      new THREE.Vector3(0, 1, 0),
      1.3,
      0xeaf7fa,
      0.23,
      0.1
    );
    this.gArrow.line.material.depthTest = false;
    this.gArrow.line.material.depthWrite = false;
    this.gArrow.line.material.transparent = true;
    this.gArrow.line.material.opacity = 0.9;
    this.gArrow.line.material.toneMapped = false;
    this.gArrow.line.renderOrder = 38;
    this.gArrow.cone.material.depthTest = false;
    this.gArrow.cone.material.depthWrite = false;
    this.gArrow.cone.material.transparent = true;
    this.gArrow.cone.material.opacity = 0.92;
    this.gArrow.cone.material.toneMapped = false;
    this.gArrow.cone.renderOrder = 38;
    this.scene.add(this.gArrow);
  };

  CorneringChassisScene.prototype.updateCogAndG = function () {
    this.cogWorld.setFromMatrixPosition(this.cogAnchor.matrixWorld);

    var positionAttribute = this.cogPlumb.geometry.attributes.position;
    positionAttribute.setXYZ(0, this.cogWorld.x, 0.012, this.cogWorld.z);
    positionAttribute.setXYZ(1, this.cogWorld.x, this.cogWorld.y, this.cogWorld.z);
    positionAttribute.needsUpdate = true;
    this.cogPlumb.geometry.computeBoundingSphere();

    this.cogGroundRing.position.x = this.cogWorld.x;
    this.cogGroundRing.position.z = this.cogWorld.z;

    var lateralG = this.visual.lateralG;
    var longitudinalG = this.visual.longitudinalG;
    var magnitude = Math.hypot(lateralG, longitudinalG);

    if (magnitude > 1e-5) {
      // Positive lateralG is a right turn, so its inertial force points left
      // (outside of the turn). Acceleration pushes the arrow rearward.
      this.gDirection.set(-lateralG / magnitude, 0, -longitudinalG / magnitude);
      this.gArrow.setDirection(this.gDirection);
    }

    this.currentGArrowLength = 0.58 + magnitude * 0.85;
    this.gArrow.position.set(this.cogWorld.x, this.cogWorld.y + 0.015, this.cogWorld.z);
    this.gArrow.setLength(
      this.currentGArrowLength,
      clamp(this.currentGArrowLength * 0.15, 0.16, 0.28),
      clamp(this.currentGArrowLength * 0.07, 0.075, 0.14)
    );
  };

  CorneringChassisScene.prototype.bindControls = function () {
    var canvas = this.renderer.domElement;
    var self = this;

    canvas.addEventListener('pointerdown', function (event) {
      if (event.button !== 0 && event.pointerType === 'mouse') {
        return;
      }
      self.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      canvas.setPointerCapture(event.pointerId);
      self.container.classList.add('is-dragging');
      if (self.pointers.size === 2) {
        var values = Array.from(self.pointers.values());
        self.pinchDistance = Math.hypot(values[0].x - values[1].x, values[0].y - values[1].y);
      }
    });

    canvas.addEventListener('pointermove', function (event) {
      var pointer = self.pointers.get(event.pointerId);
      if (!pointer) {
        return;
      }

      var dx = event.clientX - pointer.x;
      var dy = event.clientY - pointer.y;
      pointer.x = event.clientX;
      pointer.y = event.clientY;

      if (self.pointers.size === 1) {
        self.orbit.targetTheta -= dx * 0.006;
        self.orbit.targetPhi = clamp(self.orbit.targetPhi - dy * 0.0055, 0.24, 1.48);
      } else if (self.pointers.size === 2) {
        var values = Array.from(self.pointers.values());
        var distance = Math.hypot(values[0].x - values[1].x, values[0].y - values[1].y);
        if (self.pinchDistance > 0) {
          self.orbit.targetRadius = clamp(self.orbit.targetRadius * (self.pinchDistance / distance), 3.6, 10.5);
        }
        self.pinchDistance = distance;
      }
    });

    function releasePointer(event) {
      self.pointers.delete(event.pointerId);
      if (canvas.hasPointerCapture && canvas.hasPointerCapture(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId);
      }
      if (self.pointers.size === 0) {
        self.container.classList.remove('is-dragging');
      }
      if (self.pointers.size < 2) {
        self.pinchDistance = 0;
      }
    }

    canvas.addEventListener('pointerup', releasePointer);
    canvas.addEventListener('pointercancel', releasePointer);

    canvas.addEventListener('wheel', function (event) {
      event.preventDefault();
      var zoom = Math.exp(event.deltaY * 0.0011);
      self.orbit.targetRadius = clamp(self.orbit.targetRadius * zoom, 3.6, 10.5);
    }, { passive: false });

    canvas.addEventListener('dblclick', function () {
      self.resetView();
    });
  };

  CorneringChassisScene.prototype.setModel = function (result) {
    var loads = result.wheelLoads;
    this.target.loads.FL = loads.FL;
    this.target.loads.FR = loads.FR;
    this.target.loads.RL = loads.RL;
    this.target.loads.RR = loads.RR;
    var turnSign = result.turnDirection === 'right' ? 1 :
      result.turnDirection === 'left' ? -1 : 0;
    this.target.roll = clamp(result.rollAngleRad, 0, 0.16) * turnSign;
    this.target.pitch = clamp(-result.state.longitudinalG * 0.022, -0.035, 0.035);
    this.target.steer = clamp(result.state.lateralG * 0.105, -0.17, 0.17);
    this.target.lateralG = result.state.lateralG;
    this.target.longitudinalG = result.state.longitudinalG;
    if (result.state.tireVerticalRateNm > 0) {
      this.tyreVerticalRate = result.state.tireVerticalRateNm;
    }

    var cogHeight = clamp(result.state.cgHeightM, 0.2, 0.7);
    var bodyScaleZ = this.body.scale.z || 1;
    var cogZ = (result.state.frontWeight - 0.5) * result.state.wheelbaseM / bodyScaleZ;
    this.cogAnchor.position.set(0, cogHeight - DIM.rollCenterY, cogZ);
  };

  CorneringChassisScene.prototype.resetView = function () {
    this.orbit.targetRadius = 6.5;
    this.orbit.targetTheta = 0.73;
    this.orbit.targetPhi = 1.1;
  };

  CorneringChassisScene.prototype.resize = function () {
    if (!this.renderer) {
      return;
    }
    var width = Math.max(1, this.container.clientWidth);
    var height = Math.max(1, this.container.clientHeight);
    this.renderer.setPixelRatio(Math.min(global.devicePixelRatio || 1, 2));
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;

    // Keep roughly 40 degrees of horizontal field of view so the chassis
    // and its floating load labels fit a tall/narrow stage as well as a wide one.
    var targetHorizontalFov = 40 * Math.PI / 180;
    var verticalFov = 2 * Math.atan(Math.tan(targetHorizontalFov / 2) / this.camera.aspect);
    this.camera.fov = clamp(verticalFov * 180 / Math.PI, 32, 52);
    this.camera.far = 60;
    this.camera.updateProjectionMatrix();
  };

  CorneringChassisScene.prototype.updateWorldPositions = function () {
    var self = this;
    this.scene.updateMatrixWorld(true);

    this.links.forEach(function (entry) {
      TMP_A.setFromMatrixPosition(entry.a.matrixWorld);
      TMP_B.setFromMatrixPosition(entry.b.matrixWorld);
      placeRod(entry.mesh, TMP_A, TMP_B);
    });

    this.springs.forEach(function (spring) {
      TMP_A.setFromMatrixPosition(spring.lower.matrixWorld);
      TMP_B.setFromMatrixPosition(spring.upper.matrixWorld);

      var length = TMP_DIR.subVectors(TMP_B, TMP_A).length();
      var usableLength = Math.max(0.08, length);
      var startT = 0.19;
      var endT = 0.93;
      TMP_C.copy(TMP_A).lerp(TMP_B, startT);
      var upperStart = TMP_A.clone().lerp(TMP_B, endT);

      spring.mesh.visible = true;
      spring.mesh.position.copy(TMP_C);
      TMP_DIR.subVectors(upperStart, TMP_C);
      var springLength = Math.max(0.05, TMP_DIR.length());
      TMP_QUAT.setFromUnitVectors(UP, TMP_DIR.normalize());
      spring.mesh.quaternion.copy(TMP_QUAT);
      spring.mesh.scale.set(1, springLength, 1);

      setObjectBetween(spring.seatBottom, TMP_C, TMP_C.clone().addScaledVector(UP, 0.001));
      spring.seatBottom.position.copy(TMP_C);
      spring.seatBottom.quaternion.copy(TMP_QUAT);
      spring.seatBottom.scale.set(1, 1, 1);

      setObjectBetween(spring.seatTop, upperStart, upperStart.clone().addScaledVector(UP, 0.001));
      spring.seatTop.position.copy(upperStart);
      spring.seatTop.quaternion.copy(TMP_QUAT);
      spring.seatTop.scale.set(1, 1, 1);
    });
  };

  CorneringChassisScene.prototype.updateLabelPositions = function () {
    if (!this.wheelLabels.length && !this.cogLabel && !this.gLabel) {
      return;
    }

    var width = this.container.clientWidth;
    var height = this.container.clientHeight;
    var self = this;
    this.camera.updateMatrixWorld();

    function projectAnchor(worldPosition) {
      var projected = worldPosition.clone().project(self.camera);
      return {
        x: (projected.x * 0.5 + 0.5) * width,
        y: (-projected.y * 0.5 + 0.5) * height,
        visible: projected.z > -1 && projected.z < 1
      };
    }

    this.wheelLabels.forEach(function (label) {
      var wheelId = label.getAttribute('data-wheel-label');
      var wheel = self.corners[wheelId];
      if (!wheel) {
        return;
      }

      TMP_A.set(0, 0.41, 0);
      TMP_A.x += wheel.side * 0.16;
      TMP_A.applyMatrix4(wheel.root.matrixWorld);

      var position = projectAnchor(TMP_A);
      var visible = position.visible &&
        position.x > -70 && position.x < width + 70 &&
        position.y > -40 && position.y < height + 40;

      label.style.transform = 'translate(-50%, -50%) translate(' +
        position.x.toFixed(1) + 'px, ' + position.y.toFixed(1) + 'px)';
      label.style.opacity = visible ? '1' : '0';
    });

    if (this.cogLabel) {
      TMP_A.copy(this.cogWorld);
      TMP_A.y += 0.19;
      var cogPosition = projectAnchor(TMP_A);
      var cogVisible = cogPosition.visible &&
        cogPosition.x > 0 && cogPosition.x < width &&
        cogPosition.y > 0 && cogPosition.y < height;
      this.cogLabel.style.transform = 'translate(-50%, -50%) translate(' +
        cogPosition.x.toFixed(1) + 'px, ' + cogPosition.y.toFixed(1) + 'px)';
      this.cogLabel.style.opacity = cogVisible ? '1' : '0';
    }

    if (this.gLabel) {
      TMP_A.copy(this.cogWorld).addScaledVector(
        this.gDirection,
        this.currentGArrowLength * 0.74
      );
      TMP_A.y += 0.12;
      var gPosition = projectAnchor(TMP_A);
      var gVisible = gPosition.visible &&
        gPosition.x > 0 && gPosition.x < width &&
        gPosition.y > 0 && gPosition.y < height;
      this.gLabel.style.transform = 'translate(-50%, -50%) translate(' +
        gPosition.x.toFixed(1) + 'px, ' + gPosition.y.toFixed(1) + 'px)';
      this.gLabel.style.opacity = gVisible ? '1' : '0';
    }
  };

  CorneringChassisScene.prototype.update = function (dt) {
    var self = this;

    this.visual.roll = damp(this.visual.roll, this.target.roll, 8.5, dt);
    this.visual.pitch = damp(this.visual.pitch, this.target.pitch, 8.5, dt);
    this.visual.steer = damp(this.visual.steer, this.target.steer, 7.5, dt);
    this.visual.lateralG = damp(this.visual.lateralG, this.target.lateralG, 7, dt);
    this.visual.longitudinalG = damp(
      this.visual.longitudinalG,
      this.target.longitudinalG,
      7,
      dt
    );

    ['FL', 'FR', 'RL', 'RR'].forEach(function (wheelId) {
      self.visual.loads[wheelId] = damp(self.visual.loads[wheelId], self.target.loads[wheelId], 8, dt);
    });

    // Positive lateralG is a right turn: the body rolls left (positive
    // rotation.z), while a left turn rolls right. Positive rotation.x pitches
    // the nose down, which is the braking case.
    this.body.rotation.z = this.visual.roll;
    this.body.rotation.x = this.visual.pitch;
    this.body.position.y = DIM.rollCenterY;

    ['FL', 'FR', 'RL', 'RR'].forEach(function (wheelId) {
      var wheel = self.corners[wheelId];
      var load = Math.max(0, self.visual.loads[wheelId]);
      var deflection = clamp(load / self.tyreVerticalRate, 0, 0.048);
      wheel.root.position.y = DIM.wheelRadius - deflection;
      wheel.tire.scale.y = clamp(1 - deflection / DIM.wheelRadius, 0.86, 1);
      if (wheel.axle === 'front') {
        wheel.root.rotation.y = self.visual.steer;
      }
    });

    // ARB arms rotate opposite one another to show the torsion-bar twist.
    var arbTwist = clamp(this.visual.roll * 1.4, -0.11, 0.11);
    ['front', 'rear'].forEach(function (axle) {
      self.arbArms[axle].L.pivot.rotation.x = arbTwist;
      self.arbArms[axle].R.pivot.rotation.x = -arbTwist;
    });

    this.scene.updateMatrixWorld(true);
    this.updateWorldPositions();
    this.updateCogAndG();

    // Camera easing.
    this.orbit.theta = damp(this.orbit.theta, this.orbit.targetTheta, 12, dt);
    this.orbit.phi = damp(this.orbit.phi, this.orbit.targetPhi, 12, dt);
    this.orbit.radius = damp(this.orbit.radius, this.orbit.targetRadius, 10, dt);

    var spherical = new THREE.Spherical(
      this.orbit.radius,
      this.orbit.phi,
      this.orbit.theta
    );
    TMP_C.setFromSpherical(spherical).add(this.cameraTarget);
    this.camera.position.copy(TMP_C);
    this.camera.lookAt(this.cameraTarget);
    this.camera.updateMatrixWorld();
  };

  CorneringChassisScene.prototype.animate = function (now) {
    if (this.disposed) {
      return;
    }

    var dt = Math.min(0.05, Math.max(0.001, (now - this.lastTime) / 1000));
    this.lastTime = now;
    this.elapsed += dt;

    this.update(dt);
    this.renderer.render(this.scene, this.camera);
    this.updateLabelPositions();

    if (!this.ready) {
      this.ready = true;
      this.container.classList.add('is-ready');
      if (this.loading) {
        this.loading.classList.add('is-hidden');
      }
      if (typeof this.options.onReady === 'function') {
        this.options.onReady();
      }
    }

    this.animationFrame = global.requestAnimationFrame(this.animate);
  };

  CorneringChassisScene.prototype.dispose = function () {
    this.disposed = true;
    if (this.animationFrame) {
      global.cancelAnimationFrame(this.animationFrame);
    }
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }
    this.scene.traverse(function (object) {
      if (object.geometry) {
        object.geometry.dispose();
      }
      if (object.material) {
        if (Array.isArray(object.material)) {
          object.material.forEach(function (material) { material.dispose(); });
        } else {
          object.material.dispose();
        }
      }
    });
    if (this.renderer) {
      this.renderer.dispose();
    }
  };

  CorneringChassisScene.prototype.frameAccentMaterial = null;

  global.CorneringChassisScene = CorneringChassisScene;
})(window);
