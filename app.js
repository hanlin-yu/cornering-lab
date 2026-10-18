(function () {
  'use strict';

  var model = window.CorneringModel;
  if (!model) {
    return;
  }

  var state = model.cloneBaseState();
  var scene = null;
  var autoNoteTimer = null;
  var TYRE_COMPOUNDS = model.DATA.tyreCompounds;
  var currentTyreId = model.DATA.defaultCompoundId;
  var SVG_NS = 'http://www.w3.org/2000/svg';
  var G_PAD = Object.freeze({
    width: 320,
    height: 190,
    left: 32,
    right: 12,
    top: 20,
    bottom: 160,
    longMin: -1.20,
    longMax: 0.90,
    latMin: 0.20,
    latMax: 1.40
  });
  var gTrail = [];
  var gLastTrailPoint = null;
  var gPadDragging = false;
  var gPadPointerId = null;
  var gPlaying = false;
  var gPlayFrame = null;
  var gPlayStart = 0;
  var gPlayLastRender = 0;
  var G_PLAY_DURATION_MS = 6200;

  var PRESETS = {
    stock: {
      springFrontNmm: 23,
      springRearNmm: 18,
      arbFrontNmm: 39,
      arbRearNmm: 5
    },
    front: {
      springFrontNmm: 30,
      springRearNmm: 18,
      arbFrontNmm: 60,
      arbRearNmm: 5
    },
    rear: {
      springFrontNmm: 23,
      springRearNmm: 24,
      arbFrontNmm: 39,
      arbRearNmm: 40
    }
  };

  var TYRE_POINT_DEFS = [
    {
      code: 'FL',
      axle: 'front',
      side: 'inner',
      front: true,
      gripKey: 'frontInner',
      fzId: 'curveFLFz',
      muId: 'curveFLMu',
      labelDx: -10,
      labelDy: -9,
      anchor: 'end'
    },
    {
      code: 'FR',
      axle: 'front',
      side: 'outer',
      front: true,
      gripKey: 'frontOuter',
      fzId: 'curveFRFz',
      muId: 'curveFRMu',
      labelDx: 10,
      labelDy: -9,
      anchor: 'start'
    },
    {
      code: 'RL',
      axle: 'rear',
      side: 'inner',
      front: false,
      gripKey: 'rearInner',
      fzId: 'curveRLFz',
      muId: 'curveRLMu',
      labelDx: -10,
      labelDy: 16,
      anchor: 'end'
    },
    {
      code: 'RR',
      axle: 'rear',
      side: 'outer',
      front: false,
      gripKey: 'rearOuter',
      fzId: 'curveRRFz',
      muId: 'curveRRMu',
      labelDx: 10,
      labelDy: 16,
      anchor: 'start'
    }
  ];

  var COPY = {
    understeer: {
      cn: '推头',
      en: 'UNDERSTEER',
      kicker: 'FRONT AXLE SATURATES FIRST',
      sub: '前轴联合利用率更高，前轮先失去侧向余量。',
      hint: '往中性：软化前轴弹簧 / ARB，或增加后轴侧倾刚度。'
    },
    oversteer: {
      cn: '甩尾',
      en: 'OVERSTEER',
      kicker: 'REAR AXLE SATURATES FIRST',
      sub: '后轴联合利用率更高，后轮先失去侧向余量。',
      hint: '往中性：软化后轴弹簧 / ARB，或增加前轴侧倾刚度。'
    },
    neutral: {
      cn: '中性',
      en: 'NEUTRAL',
      kicker: 'AXLES REACH THE LIMIT TOGETHER',
      sub: '前后轴联合利用率几乎相同，接近同时达到极限。',
      hint: '前后轴联合利用率差位于 ±0.35 pp 中性带内。'
    }
  };

  var parameterElements = Array.prototype.slice.call(document.querySelectorAll('[data-param]'));
  var rangeElements = parameterElements.filter(function (element) {
    return element.type === 'range';
  });

  function $(id) {
    return document.getElementById(id);
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function formatNumber(value, digits) {
    if (!Number.isFinite(value)) {
      return '—';
    }
    return value.toFixed(digits);
  }

  function formatForce(kN) {
    return formatNumber(kN / 1000, 2);
  }

  function formatPercent(fraction) {
    if (!Number.isFinite(fraction)) {
      return '>999%';
    }
    return (fraction * 100).toFixed(1) + '%';
  }

  function formatSigned(value, digits) {
    var d = digits == null ? 1 : digits;
    if (!Number.isFinite(value)) {
      return '—';
    }
    if (Math.abs(value) < 0.5 * Math.pow(10, -d)) {
      return (0).toFixed(d);
    }
    return (value > 0 ? '+' : '−') + Math.abs(value).toFixed(d);
  }

  function formatInputValue(value) {
    var rounded = Math.round(value * 10000) / 10000;
    return String(rounded);
  }

  function setText(id, text) {
    var element = $(id);
    if (element) {
      element.textContent = text;
    }
  }

  function toggleClass(element, className, enabled) {
    if (element) {
      element.classList.toggle(className, enabled);
    }
  }

  function setBarWidth(element, fraction) {
    if (!element) {
      return;
    }
    var percent = Number.isFinite(fraction) ? clamp(fraction, 0, 1) * 100 : 100;
    element.style.width = percent.toFixed(2) + '%';
    toggleClass(element, 'is-over', Number.isFinite(fraction) && fraction >= 1);
  }

  function updateRangeFill(element) {
    if (!element || element.type !== 'range') {
      return;
    }
    var min = Number(element.min);
    var max = Number(element.max);
    var value = Number(element.value);
    var fraction = max > min ? (value - min) / (max - min) : 0;
    element.style.setProperty('--fill', (clamp(fraction, 0, 1) * 100).toFixed(2) + '%');
  }

  function createSvgElement(tag, attributes, text) {
    var element = document.createElementNS(SVG_NS, tag);
    if (attributes) {
      Object.keys(attributes).forEach(function (key) {
        element.setAttribute(key, attributes[key]);
      });
    }
    if (text != null) {
      element.textContent = text;
    }
    return element;
  }

  function clearSvgGroup(group) {
    if (!group) {
      return;
    }
    while (group.firstChild) {
      group.removeChild(group.firstChild);
    }
  }

  function niceStep(value) {
    if (!(value > 0) || !Number.isFinite(value)) {
      return 1;
    }
    var exponent = Math.floor(Math.log(value) / Math.LN10);
    var magnitude = Math.pow(10, exponent);
    var fraction = value / magnitude;
    var niceFraction;
    if (fraction <= 1) {
      niceFraction = 1;
    } else if (fraction <= 2) {
      niceFraction = 2;
    } else if (fraction <= 2.5) {
      niceFraction = 2.5;
    } else if (fraction <= 5) {
      niceFraction = 5;
    } else {
      niceFraction = 10;
    }
    return niceFraction * magnitude;
  }

  function currentTyreName() {
    if (currentTyreId === 'custom') {
      return '自定义';
    }
    var compound = TYRE_COMPOUNDS[currentTyreId];
    return compound ? compound.name : '—';
  }

  function syncTyreUi() {
    var select = $('tyreCompoundSelect');
    if (select && select.value !== currentTyreId) {
      select.value = currentTyreId;
    }

    var customFields = $('tyreCustomFields');
    if (customFields) {
      customFields.hidden = currentTyreId !== 'custom';
    }

    var compound = TYRE_COMPOUNDS[currentTyreId];
    var tag = currentTyreId === 'custom' ? 'CUSTOM' : compound ? compound.short : 'TYRE';

    setText('compoundTag', tag);
    setText('tyreMuReadout', state.tireMuRef.toFixed(3));
    setText('tyreKReadout', state.tireLoadSensitivityK.toFixed(3));
    setText('tyreFz0Readout', String(Math.round(state.tireFz0N)));
    setText('curveTyreName', currentTyreName());
    setText('curveMuRef', state.tireMuRef.toFixed(3));
    setText('curveK', state.tireLoadSensitivityK.toFixed(3));
    setText('curveFz0', String(Math.round(state.tireFz0N)));
  }

  function gPadX(longitudinalG) {
    var plotWidth = G_PAD.width - G_PAD.left - G_PAD.right;
    var fraction = (longitudinalG - G_PAD.longMin) / (G_PAD.longMax - G_PAD.longMin);
    return G_PAD.left + fraction * plotWidth;
  }

  function gPadY(lateralG) {
    var plotHeight = G_PAD.bottom - G_PAD.top;
    var fraction = (lateralG - G_PAD.latMin) / (G_PAD.latMax - G_PAD.latMin);
    return G_PAD.bottom - fraction * plotHeight;
  }

  function gPadPath(points) {
    if (!points.length) {
      return '';
    }
    return points.map(function (point, index) {
      return (index === 0 ? 'M' : 'L') +
        gPadX(point.long).toFixed(2) + ' ' + gPadY(point.lat).toFixed(2);
    }).join(' ');
  }

  function cornerPointAt(progress) {
    var s = clamp(progress, 0, 1);
    var lat = G_PAD.latMin + 0.75 * Math.sin(Math.PI * Math.pow(s, 0.9));
    var long = -0.85 * Math.pow(1 - s, 1.6) + 0.45 * Math.pow(s, 2.2);
    return {
      lat: clamp(lat, G_PAD.latMin, G_PAD.latMax),
      long: clamp(long, G_PAD.longMin, G_PAD.longMax)
    };
  }

  function gPadPhase(lat, long) {
    if (long < -0.25) {
      return '入弯 / TURN-IN';
    }
    if (lat >= 0.88 && Math.abs(long) <= 0.30) {
      return '弯心 / APEX';
    }
    if (long > 0.18) {
      return '出弯 / EXIT';
    }
    return '弯中 / MID';
  }

  function buildGPad() {
    var grid = $('gPadGrid');
    var axes = $('gPadAxes');
    var guide = $('gPadCornerGuide');
    if (!grid || !axes || !guide) {
      return;
    }

    clearSvgGroup(grid);
    clearSvgGroup(axes);

    var xTicks = [-1.2, -0.8, -0.4, 0, 0.4, 0.8];
    var yTicks = [0.2, 0.6, 1.0, 1.4];

    xTicks.forEach(function (tick) {
      var px = gPadX(tick);
      grid.appendChild(createSvgElement('line', {
        x1: px.toFixed(2),
        y1: G_PAD.top,
        x2: px.toFixed(2),
        y2: G_PAD.bottom
      }));
      axes.appendChild(createSvgElement('text', {
        x: px.toFixed(2),
        y: G_PAD.bottom + 12,
        'text-anchor': 'middle'
      }, tick === 0 ? '0' : tick.toFixed(1)));
    });

    yTicks.forEach(function (tick) {
      var py = gPadY(tick);
      grid.appendChild(createSvgElement('line', {
        x1: G_PAD.left,
        y1: py.toFixed(2),
        x2: G_PAD.width - G_PAD.right,
        y2: py.toFixed(2)
      }));
      axes.appendChild(createSvgElement('text', {
        x: G_PAD.left - 5,
        y: (py + 2.6).toFixed(2),
        'text-anchor': 'end'
      }, tick.toFixed(1)));
    });

    axes.appendChild(createSvgElement('line', {
      x1: G_PAD.left,
      y1: G_PAD.bottom,
      x2: G_PAD.width - G_PAD.right,
      y2: G_PAD.bottom
    }));
    axes.appendChild(createSvgElement('line', {
      x1: gPadX(0).toFixed(2),
      y1: G_PAD.top,
      x2: gPadX(0).toFixed(2),
      y2: G_PAD.bottom,
      class: 'g-pad-zero-axis'
    }));

    axes.appendChild(createSvgElement('text', {
      x: G_PAD.left,
      y: G_PAD.top - 7,
      'text-anchor': 'start',
      class: 'g-pad-axis-title'
    }, 'LAT g ↑'));
    axes.appendChild(createSvgElement('text', {
      x: G_PAD.left,
      y: G_PAD.height - 3,
      'text-anchor': 'start',
      class: 'g-pad-axis-title'
    }, '← BRAKE'));
    axes.appendChild(createSvgElement('text', {
      x: G_PAD.width - G_PAD.right,
      y: G_PAD.height - 3,
      'text-anchor': 'end',
      class: 'g-pad-axis-title'
    }, 'ACCEL →'));

    var guidePoints = [];
    for (var i = 0; i <= 100; i += 1) {
      guidePoints.push(cornerPointAt(i / 100));
    }
    guide.setAttribute('d', gPadPath(guidePoints));
  }

  function clearGTrail() {
    gTrail = [];
    gLastTrailPoint = null;
    var trail = $('gPadTrail');
    if (trail) {
      trail.setAttribute('d', '');
    }
  }

  function recordGTrail(lat, long) {
    if (gLastTrailPoint &&
      Math.abs(gLastTrailPoint.lat - lat) < 0.003 &&
      Math.abs(gLastTrailPoint.long - long) < 0.003) {
      return false;
    }

    gLastTrailPoint = { lat: lat, long: long };
    gTrail.push(gLastTrailPoint);
    if (gTrail.length > 220) {
      gTrail.shift();
    }

    var trail = $('gPadTrail');
    if (trail) {
      trail.setAttribute('d', gPadPath(gTrail));
    }
    return true;
  }

  function updateGPad(result) {
    var pad = $('gPad');
    if (!pad) {
      return;
    }

    var lat = result.state.lateralG;
    var long = result.state.longitudinalG;
    var magnitude = result.gVectorMagnitude;
    var phase = gPadPhase(lat, long);
    var transferKn = result.longitudinal.transfer / 1000;

    recordGTrail(lat, long);

    var px = gPadX(long);
    var py = gPadY(lat);
    var zeroX = gPadX(0);

    var cursor = $('gPadCursor');
    var halo = $('gPadCursorHalo');
    if (cursor) {
      cursor.setAttribute('cx', px.toFixed(2));
      cursor.setAttribute('cy', py.toFixed(2));
    }
    if (halo) {
      halo.setAttribute('cx', px.toFixed(2));
      halo.setAttribute('cy', py.toFixed(2));
    }

    var projectionX = $('gPadProjectionX');
    if (projectionX) {
      projectionX.setAttribute('x1', px.toFixed(2));
      projectionX.setAttribute('y1', py.toFixed(2));
      projectionX.setAttribute('x2', px.toFixed(2));
      projectionX.setAttribute('y2', G_PAD.bottom);
    }
    var projectionY = $('gPadProjectionY');
    if (projectionY) {
      projectionY.setAttribute('x1', zeroX.toFixed(2));
      projectionY.setAttribute('y1', py.toFixed(2));
      projectionY.setAttribute('x2', px.toFixed(2));
      projectionY.setAttribute('y2', py.toFixed(2));
    }

    setText('ayValue', lat.toFixed(2));
    setText('longGValue', formatSigned(long, 2));
    setText('gMagValue', magnitude.toFixed(2));
    setText('radiusValue', Math.round(result.cornerRadiusM) + ' m');
    setText('gPhaseBadge', phase);
    setText('gLongTransferNote',
      '纵向转移 后轴 ' + formatSigned(transferKn, 2) + ' kN');

    setText('sceneAyValue', lat.toFixed(2));
    setText('sceneLongGValue', formatSigned(long, 2));
    setText('sceneGTotalValue', magnitude.toFixed(2));
    setText('sceneRadiusValue', String(Math.round(result.cornerRadiusM)));
    setText('scenePhaseText', '左转 · ' + phase);
    setText('gVectorValue', magnitude.toFixed(2));
    setText('mobileGValue', magnitude.toFixed(2));
    setText('mobileLongGValue', formatSigned(long, 2));
    setText('sceneLongTransferValue', formatSigned(transferKn, 2));

    var gLabel = document.querySelector('[data-g-label]');
    if (gLabel) {
      gLabel.title = 'G 箭头长度 = 合成 G；方向表示惯性力（外侧 / 加速向后）。';
    }

    pad.setAttribute('aria-label',
      '二维 G 输入。侧向 ' + lat.toFixed(2) + ' g，纵向 ' +
      formatSigned(long, 2) + ' g，合成 ' + magnitude.toFixed(2) +
      ' g，阶段 ' + phase + '。拖动或使用方向键调整。');
  }

  function setGInput(lat, long) {
    state.lateralG = clamp(
      lat,
      model.LIMITS.lateralG[0],
      model.LIMITS.lateralG[1]
    );
    state.longitudinalG = clamp(
      long,
      model.LIMITS.longitudinalG[0],
      model.LIMITS.longitudinalG[1]
    );
    clearAutoNote();
    render();
  }

  function stopGPlayback(finished) {
    gPlaying = false;
    if (gPlayFrame) {
      window.cancelAnimationFrame(gPlayFrame);
      gPlayFrame = null;
    }
    var button = $('gPlayButton');
    var label = $('gPlayLabel');
    if (button) {
      button.classList.remove('is-playing');
      button.setAttribute('aria-pressed', 'false');
    }
    if (label) {
      label.textContent = finished ? '再放一次' : '扫弯回放';
    }
  }

  function startGPlayback() {
    if (gPlaying) {
      stopGPlayback(false);
      return;
    }

    clearAutoNote();
    clearGTrail();
    gPlaying = true;
    gPlayStart = 0;
    gPlayLastRender = 0;

    var button = $('gPlayButton');
    var label = $('gPlayLabel');
    if (button) {
      button.classList.add('is-playing');
      button.setAttribute('aria-pressed', 'true');
    }
    if (label) {
      label.textContent = '停止回放';
    }

    function step(now) {
      if (!gPlaying) {
        return;
      }
      if (!gPlayStart) {
        gPlayStart = now;
      }
      var progress = Math.min(1, (now - gPlayStart) / G_PLAY_DURATION_MS);

      if (now - gPlayLastRender >= 32 || progress >= 1) {
        gPlayLastRender = now;
        var point = cornerPointAt(progress);
        state.lateralG = point.lat;
        state.longitudinalG = point.long;
        render();
      }

      if (progress < 1) {
        gPlayFrame = window.requestAnimationFrame(step);
      } else {
        stopGPlayback(true);
      }
    }

    gPlayFrame = window.requestAnimationFrame(step);
  }

  function bindGPad() {
    var pad = $('gPad');
    if (!pad) {
      return;
    }
    var svg = $('gPadSvg');

    function applyPointer(event) {
      var rect = svg.getBoundingClientRect();
      if (!(rect.width > 0) || !(rect.height > 0)) {
        return;
      }
      var px = (event.clientX - rect.left) * (G_PAD.width / rect.width);
      var py = (event.clientY - rect.top) * (G_PAD.height / rect.height);
      px = clamp(px, G_PAD.left, G_PAD.width - G_PAD.right);
      py = clamp(py, G_PAD.top, G_PAD.bottom);

      var long = G_PAD.longMin +
        ((px - G_PAD.left) / (G_PAD.width - G_PAD.left - G_PAD.right)) *
        (G_PAD.longMax - G_PAD.longMin);
      var lat = G_PAD.latMin +
        ((G_PAD.bottom - py) / (G_PAD.bottom - G_PAD.top)) *
        (G_PAD.latMax - G_PAD.latMin);

      setGInput(Math.round(lat * 100) / 100, Math.round(long * 100) / 100);
    }

    pad.addEventListener('pointerdown', function (event) {
      event.preventDefault();
      stopGPlayback(false);
      gPadDragging = true;
      gPadPointerId = event.pointerId;
      if (pad.setPointerCapture) {
        pad.setPointerCapture(event.pointerId);
      }
      try {
        pad.focus({ preventScroll: true });
      } catch (error) {
        pad.focus();
      }
      applyPointer(event);
    });

    pad.addEventListener('pointermove', function (event) {
      if (!gPadDragging || event.pointerId !== gPadPointerId) {
        return;
      }
      event.preventDefault();
      applyPointer(event);
    });

    function releasePointer(event) {
      if (event.pointerId !== gPadPointerId) {
        return;
      }
      gPadDragging = false;
      if (pad.hasPointerCapture && pad.hasPointerCapture(event.pointerId)) {
        pad.releasePointerCapture(event.pointerId);
      }
      gPadPointerId = null;
    }

    pad.addEventListener('pointerup', releasePointer);
    pad.addEventListener('pointercancel', releasePointer);

    pad.addEventListener('keydown', function (event) {
      var step = event.shiftKey ? 0.05 : 0.01;
      var lat = state.lateralG;
      var long = state.longitudinalG;
      var handled = true;

      switch (event.key) {
        case 'ArrowLeft':
          long -= step;
          break;
        case 'ArrowRight':
          long += step;
          break;
        case 'ArrowUp':
          lat += step;
          break;
        case 'ArrowDown':
          lat -= step;
          break;
        default:
          handled = false;
      }

      if (!handled) {
        return;
      }
      event.preventDefault();
      stopGPlayback(false);
      setGInput(
        Math.round(lat * 100) / 100,
        Math.round(long * 100) / 100
      );
    });

    var playButton = $('gPlayButton');
    if (playButton) {
      playButton.addEventListener('click', startGPlayback);
    }

    var clearButton = $('gClearTrailButton');
    if (clearButton) {
      clearButton.addEventListener('click', function () {
        stopGPlayback(false);
        clearGTrail();
        render();
      });
    }
  }

  function syncControls() {
    parameterElements.forEach(function (element) {
      var key = element.getAttribute('data-param');
      if (!(key in state)) {
        return;
      }

      if (element === document.activeElement && element.type === 'number') {
        updateRangeFill(element);
        return;
      }

      var value = state[key];
      element.value = element.type === 'number' ? formatInputValue(value) : String(value);
      updateRangeFill(element);
    });

    var frontWeightInput = $('frontWeightPct');
    if (frontWeightInput && frontWeightInput !== document.activeElement) {
      frontWeightInput.value = formatNumber(state.frontWeight * 100, 1);
    }

    rangeElements.forEach(updateRangeFill);
  }

  function clearAutoNote() {
    if (autoNoteTimer) {
      window.clearTimeout(autoNoteTimer);
      autoNoteTimer = null;
    }
    var note = $('autoBalanceNote');
    if (note) {
      note.textContent = '';
    }
  }

  function buildGaugeTicks() {
    var group = $('gaugeTicks');
    if (!group) {
      return;
    }
    var ns = 'http://www.w3.org/2000/svg';
    var centerX = 150;
    var centerY = 142;

    for (var i = 0; i <= 8; i += 1) {
      var angle = Math.PI - (i / 8) * Math.PI;
      var inner = i === 4 ? 101 : 104;
      var outer = 112;
      var line = document.createElementNS(ns, 'line');
      line.setAttribute('x1', (centerX + Math.cos(angle) * inner).toFixed(2));
      line.setAttribute('y1', (centerY - Math.sin(angle) * inner).toFixed(2));
      line.setAttribute('x2', (centerX + Math.cos(angle) * outer).toFixed(2));
      line.setAttribute('y2', (centerY - Math.sin(angle) * outer).toFixed(2));
      if (i === 4) {
        line.setAttribute('class', 'is-center');
      } else if (i % 2 === 0) {
        line.setAttribute('class', 'is-major');
      }
      group.appendChild(line);
    }
  }

  function updateWheelLabels(result) {
    var loadMap = {
      FL: result.wheelLoads.frontInner,
      FR: result.wheelLoads.frontOuter,
      RL: result.wheelLoads.rearInner,
      RR: result.wheelLoads.rearOuter
    };
    var staticMap = {
      FL: result.staticLoads.frontWheel,
      FR: result.staticLoads.frontWheel,
      RL: result.staticLoads.rearWheel,
      RR: result.staticLoads.rearWheel
    };

    ['FL', 'FR', 'RL', 'RR'].forEach(function (wheelId) {
      var element = document.querySelector('[data-wheel-load="' + wheelId + '"]');
      if (element) {
        element.textContent = formatForce(loadMap[wheelId]);
      }

      var staticLoad = staticMap[wheelId];
      var changePct = staticLoad > 0 ? ((loadMap[wheelId] - staticLoad) / staticLoad) * 100 : 0;
      var deltaElement = document.querySelector('[data-wheel-delta="' + wheelId + '"]');
      if (deltaElement) {
        var sign = changePct > 0.05 ? '+' : changePct < -0.05 ? '−' : '';
        deltaElement.textContent = '(' + sign + Math.abs(changePct).toFixed(1) + '%)';
      }

      var label = document.querySelector('[data-wheel-label="' + wheelId + '"]');
      if (label) {
        var lifted = wheelId === 'FL' ? result.wheelLift.front :
          wheelId === 'RL' ? result.wheelLift.rear : false;
        label.classList.toggle('is-lifted', lifted);
      }
    });
  }

  function updateWarnings(result) {
    var container = $('warnings');
    if (!container) {
      return;
    }
    container.innerHTML = '';

    result.warnings.forEach(function (warning) {
      var item = document.createElement('div');
      item.className = 'warning' + (warning.severity === 'danger' ? ' warning--danger' : '');

      var text = document.createElement('div');
      var title = document.createElement('strong');
      title.textContent = warning.title;
      var detail = document.createElement('span');
      detail.textContent = warning.detail;
      text.appendChild(title);
      text.appendChild(detail);
      item.appendChild(text);
      container.appendChild(item);
    });
  }

  function updateExplanation(result) {
    var element = $('balanceExplanation');
    if (!element) {
      return;
    }

    var delta = Math.abs(result.deltaPP).toFixed(1);
    var frontShare = (result.rollStiffness.frontShare * 100).toFixed(1);
    var rearShare = (result.rollStiffness.rearShare * 100).toFixed(1);

    var frontTransferPct = (result.loadTransferRatio.front * 100).toFixed(1);
    var rearTransferPct = (result.loadTransferRatio.rear * 100).toFixed(1);

    if (result.balance === 'understeer') {
      var frontMuOuter = result.tyreGrip.frontOuter.mu;
      var frontMuInner = result.tyreGrip.frontInner.mu;
      element.innerHTML =
        '前轴侧倾刚度占比 <strong>' + frontShare + '%</strong>，前轴产生 <strong>' +
        formatForce(result.frontLoadTransfer) + ' kN（' + frontTransferPct + '% Fz）</strong> 的侧向载荷转移。' +
        '外侧前轮加载后 μ 降至 <strong>' + formatNumber(frontMuOuter, 3) +
        '</strong>（内侧 ' + formatNumber(frontMuInner, 3) + '），前轴总抓地力 <strong>' +
        formatForce(result.grip.front) + ' kN</strong>。' +
        '前轴合成需求 <strong>' + formatForce(result.demand.front) +
        ' kN</strong>（Fx ' + formatSigned(result.longitudinalDemand.front / 1000, 2) +
        ' / Fy ' + formatForce(result.lateralDemand.front) + '），联合利用率高出后轴 <strong>' +
        delta + ' pp</strong>，前轮先到极限。';
    } else if (result.balance === 'oversteer') {
      var rearMuOuter = result.tyreGrip.rearOuter.mu;
      var rearMuInner = result.tyreGrip.rearInner.mu;
      element.innerHTML =
        '后轴侧倾刚度占比 <strong>' + rearShare + '%</strong>，后轴产生 <strong>' +
        formatForce(result.rearLoadTransfer) + ' kN（' + rearTransferPct + '% Fz）</strong> 的侧向载荷转移。' +
        '外侧后轮加载后 μ 降至 <strong>' + formatNumber(rearMuOuter, 3) +
        '</strong>（内侧 ' + formatNumber(rearMuInner, 3) + '），后轴总抓地力 <strong>' +
        formatForce(result.grip.rear) + ' kN</strong>。' +
        '后轴合成需求 <strong>' + formatForce(result.demand.rear) +
        ' kN</strong>（Fx ' + formatSigned(result.longitudinalDemand.rear / 1000, 2) +
        ' / Fy ' + formatForce(result.lateralDemand.rear) + '），联合利用率高出前轴 <strong>' +
        delta + ' pp</strong>，后轮先到极限。';
    } else {
      element.innerHTML =
        '前后轴联合利用率差仅 <strong>' + delta + ' pp</strong>，两轴接近同时达到极限。' +
        '当前侧倾刚度分配为前 <strong>' + frontShare + '%</strong> / 后 <strong>' + rearShare + '%</strong>。';
    }
  }

  function updateCards(result) {
    setText('frontGripValue', formatForce(result.grip.front));
    setText('rearGripValue', formatForce(result.grip.rear));
    setText('frontDemandValue', formatForce(result.demand.front));
    setText('rearDemandValue', formatForce(result.demand.rear));
    setText('frontLongForceValue',
      formatSigned(result.longitudinalDemand.front / 1000, 2));
    setText('rearLongForceValue',
      formatSigned(result.longitudinalDemand.rear / 1000, 2));
    setText('frontLatForceValue', formatForce(result.lateralDemand.front));
    setText('rearLatForceValue', formatForce(result.lateralDemand.rear));

    setText('frontUtilCardValue', formatPercent(result.utilisation.front));
    setText('rearUtilCardValue', formatPercent(result.utilisation.rear));

    setBarWidth($('frontUtilBarCard'), result.utilisation.front);
    setBarWidth($('rearUtilBarCard'), result.utilisation.rear);

    var frontReserve = result.margin.front;
    var rearReserve = result.margin.rear;
    var frontReserveElement = $('frontReserveValue');
    var rearReserveElement = $('rearReserveValue');

    if (frontReserveElement) {
      frontReserveElement.textContent = (frontReserve >= 0 ? '+' : '−') +
        Math.abs(frontReserve / 1000).toFixed(2) + ' kN ' + (frontReserve >= 0 ? '余量' : '超限');
      frontReserveElement.classList.toggle('is-over', frontReserve < 0);
    }
    if (rearReserveElement) {
      rearReserveElement.textContent = (rearReserve >= 0 ? '+' : '−') +
        Math.abs(rearReserve / 1000).toFixed(2) + ' kN ' + (rearReserve >= 0 ? '余量' : '超限');
      rearReserveElement.classList.toggle('is-over', rearReserve < 0);
    }

    var frontTransferPct = (result.loadTransferRatio.front * 100).toFixed(1);
    var rearTransferPct = (result.loadTransferRatio.rear * 100).toFixed(1);
    setText('frontTransferPct', frontTransferPct);
    setText('rearTransferPct', rearTransferPct);
    setText('frontTransferAbs', ' · ' + formatForce(result.frontLoadTransfer) + ' kN');
    setText('rearTransferAbs', ' · ' + formatForce(result.rearLoadTransfer) + ' kN');
    setText('frontRollShareValue', (result.rollStiffness.frontShare * 100).toFixed(1));
    setText('rearRollShareValue', (result.rollStiffness.rearShare * 100).toFixed(1));
    setText('frontWheelLoadsValue',
      formatForce(result.wheelLoads.frontOuter) + ' / ' + formatForce(result.wheelLoads.frontInner));
    setText('rearWheelLoadsValue',
      formatForce(result.wheelLoads.rearOuter) + ' / ' + formatForce(result.wheelLoads.rearInner));
    setText('frontWheelRateValue', (result.springRates.frontNmm).toFixed(1));
    setText('rearWheelRateValue', (result.springRates.rearNmm).toFixed(1));

    toggleClass($('frontUtilCardValue'), 'is-over', result.utilisation.front >= 1);
    toggleClass($('rearUtilCardValue'), 'is-over', result.utilisation.rear >= 1);
  }

  function updateBalance(result) {
    var copy = COPY[result.balance] || COPY.neutral;
    var hero = $('statusHero');
    var limits = [];
    if (result.axleLimitReached) limits.push('AXLE LIMIT');
    if (result.limitExceeded) limits.push('GRIP LIMIT');

    document.documentElement.setAttribute('data-balance', result.balance);

    if (hero) {
      hero.setAttribute('data-state', result.balance);
    }

    setText('statusCn', copy.cn);
    setText('statusEn', copy.en);
    setText('statusKicker', copy.kicker + (limits.length ? ' · ' + limits.join(' / ') : ''));
    setText('statusSub', copy.sub);
    setText('tuningHint', copy.hint);

    var deltaElement = $('balanceDeltaValue');
    if (deltaElement) {
      deltaElement.textContent = formatSigned(result.deltaPP, 1);
    }

    var needleAngle = -clamp(result.deltaPP / 8, -1, 1) * 70;
    var needleGroup = $('needleGroup');
    if (needleGroup) {
      needleGroup.style.transform = 'rotate(' + needleAngle.toFixed(2) + 'deg)';
    }

    var gauge = $('balanceGauge');
    if (gauge) {
      gauge.setAttribute('aria-label',
        '转向平衡仪表：' + copy.cn + '，前轴减后轴利用率差 ' + formatSigned(result.deltaPP, 1) + ' 个百分点。');
    }

    setBarWidth($('frontUtilBar'), result.utilisation.front);
    setBarWidth($('rearUtilBar'), result.utilisation.rear);
    setText('frontUtilValue', formatPercent(result.utilisation.front));
    setText('rearUtilValue', formatPercent(result.utilisation.rear));
    toggleClass($('frontUtilValue'), 'is-over', result.utilisation.front >= 1);
    toggleClass($('rearUtilValue'), 'is-over', result.utilisation.rear >= 1);

    setText('totalGripValue', formatForce(result.grip.total));
    setText('totalDemandValue', formatForce(result.demand.total));
    setBarWidth($('totalGripBar'), result.utilisation.total);

    var headroom = $('totalHeadroomValue');
    if (headroom) {
      headroom.textContent = (result.margin.total >= 0 ? '余量 +' : '超限 −') +
        Math.abs(result.margin.total / 1000).toFixed(2) + ' kN';
      headroom.classList.toggle('is-over', result.margin.total < 0);
    }

    updateExplanation(result);
    updateWarnings(result);
  }

  function updateConditionAndSetup(result) {
    setText('sceneRollValue', result.rollAngleDeg.toFixed(2));
    setText('sceneFrontShareValue', (result.rollStiffness.frontShare * 100).toFixed(1));
    setText('cogHeightValue', result.state.cgHeightM.toFixed(3));
    setText('mobileCogHeight', result.state.cgHeightM.toFixed(3));

    var frontShare = result.rollStiffness.frontShare * 100;
    var rearShare = 100 - frontShare;
    setText('splitFrontValue', frontShare.toFixed(1));
    setText('splitRearValue', rearShare.toFixed(1));
    setText('splitKValue', 'Kφ ' +
      (result.rollStiffness.front / 1000).toFixed(1) + ' / ' +
      (result.rollStiffness.rear / 1000).toFixed(1) + ' kNm/rad');

    var frontBar = $('splitFrontBar');
    var rearBar = $('splitRearBar');
    if (frontBar) frontBar.style.width = frontShare.toFixed(2) + '%';
    if (rearBar) rearBar.style.width = rearShare.toFixed(2) + '%';

    setText('frontStiffnessSummary', result.springRates.frontNmm.toFixed(1) + ' N/mm');
    setText('rearStiffnessSummary', result.springRates.rearNmm.toFixed(1) + ' N/mm');
  }

  function renderTyreCurve(result) {
    var svg = $('tyreCurveSvg');
    if (!svg) {
      return;
    }

    var gridGroup = $('tyreCurveGrid');
    var axesGroup = $('tyreCurveAxes');
    var pointsGroup = $('tyreCurvePoints');
    var frontPath = $('tyreCurveFront');
    var rearPath = $('tyreCurveRear');
    var note = $('tyreCurveNote');

    var width = 760;
    var height = 330;
    var margin = { left: 58, right: 22, top: 24, bottom: 48 };
    var plotWidth = width - margin.left - margin.right;
    var plotHeight = height - margin.top - margin.bottom;

    var tyreState = result.state;
    var muRef = tyreState.tireMuRef;
    var fz0N = tyreState.tireFz0N;
    var k = tyreState.tireLoadSensitivityK;

    function muAtLoad(load) {
      if (!(load > 0) || !(fz0N > 0)) {
        return 0;
      }
      return muRef * Math.pow(load / fz0N, -k);
    }

    var samples = TYRE_POINT_DEFS.map(function (definition) {
      var grip = result.tyreGrip[definition.gripKey];
      return {
        definition: definition,
        load: grip.load,
        mu: grip.mu,
        capacity: grip.capacity
      };
    });

    var positiveSamples = samples.filter(function (sample) {
      return sample.load > 0;
    });
    var loadValues = positiveSamples.map(function (sample) {
      return sample.load;
    });

    var minLoad = loadValues.length ? Math.min.apply(null, loadValues) : 1800;
    var maxLoad = loadValues.length ? Math.max.apply(null, loadValues) : 4700;
    var xMin = Math.max(400, Math.floor(minLoad * 0.82 / 100) * 100);
    var xMax = Math.ceil(Math.max(maxLoad * 1.12, xMin + 1800) / 500) * 500;

    var yCandidates = [muAtLoad(xMin), muAtLoad(xMax)];
    samples.forEach(function (sample) {
      if (sample.mu > 0) {
        yCandidates.push(sample.mu);
      }
    });
    var rawYMin = Math.min.apply(null, yCandidates);
    var rawYMax = Math.max.apply(null, yCandidates);
    var yPad = Math.max(0.018, (rawYMax - rawYMin) * 0.14);
    var yStep = niceStep((rawYMax - rawYMin + yPad * 2) / 4);
    var yMin = Math.max(0, Math.floor((rawYMin - yPad) / yStep) * yStep);
    var yMax = Math.ceil((rawYMax + yPad) / yStep) * yStep;
    if (!(yMax > yMin)) {
      yMax = yMin + yStep * 2;
    }

    function xPixel(load) {
      return margin.left + ((load - xMin) / (xMax - xMin)) * plotWidth;
    }

    function yPixel(mu) {
      return margin.top + (1 - (mu - yMin) / (yMax - yMin)) * plotHeight;
    }

    clearSvgGroup(gridGroup);
    clearSvgGroup(axesGroup);
    clearSvgGroup(pointsGroup);

    // Highlight the range of loads the four tyres are currently operating in.
    if (maxLoad > minLoad) {
      gridGroup.appendChild(createSvgElement('rect', {
        x: xPixel(minLoad).toFixed(2),
        y: margin.top,
        width: Math.max(1, xPixel(maxLoad) - xPixel(minLoad)).toFixed(2),
        height: plotHeight,
        class: 'tyre-load-band'
      }));
    }

    var yTicks = [];
    for (var yValue = yMin; yValue <= yMax + yStep * 0.001; yValue += yStep) {
      yTicks.push(Number(yValue.toFixed(4)));
    }
    yTicks.forEach(function (tick) {
      var py = yPixel(tick);
      gridGroup.appendChild(createSvgElement('line', {
        x1: margin.left,
        y1: py.toFixed(2),
        x2: width - margin.right,
        y2: py.toFixed(2)
      }));
      axesGroup.appendChild(createSvgElement('text', {
        x: margin.left - 9,
        y: (py + 3.2).toFixed(2),
        'text-anchor': 'end'
      }, tick.toFixed(2)));
    });

    var xStep = niceStep((xMax - xMin) / 5);
    var xTicks = [];
    for (var xValue = Math.ceil(xMin / xStep) * xStep;
      xValue <= xMax + xStep * 0.001; xValue += xStep) {
      xTicks.push(Number(xValue.toFixed(4)));
    }
    xTicks.forEach(function (tick) {
      var px = xPixel(tick);
      gridGroup.appendChild(createSvgElement('line', {
        x1: px.toFixed(2),
        y1: margin.top,
        x2: px.toFixed(2),
        y2: height - margin.bottom
      }));
      axesGroup.appendChild(createSvgElement('text', {
        x: px.toFixed(2),
        y: height - margin.bottom + 17,
        'text-anchor': 'middle'
      }, (tick / 1000).toFixed(xStep >= 1000 ? 0 : 1)));
    });

    axesGroup.appendChild(createSvgElement('line', {
      x1: margin.left,
      y1: margin.top,
      x2: margin.left,
      y2: height - margin.bottom
    }));
    axesGroup.appendChild(createSvgElement('line', {
      x1: margin.left,
      y1: height - margin.bottom,
      x2: width - margin.right,
      y2: height - margin.bottom
    }));
    axesGroup.appendChild(createSvgElement('text', {
      x: margin.left,
      y: margin.top - 8,
      'text-anchor': 'start',
      class: 'tyre-axis-title'
    }, 'μ'));
    axesGroup.appendChild(createSvgElement('text', {
      x: margin.left + plotWidth / 2,
      y: height - 9,
      'text-anchor': 'middle',
      class: 'tyre-axis-title'
    }, 'Fz / TYRE (kN)'));

    var pathData = '';
    var sampleCount = 100;
    for (var i = 0; i <= sampleCount; i += 1) {
      var sampleLoad = xMin + ((xMax - xMin) * i) / sampleCount;
      var px = xPixel(sampleLoad);
      var py = yPixel(muAtLoad(sampleLoad));
      pathData += (i === 0 ? 'M' : 'L') + px.toFixed(2) + ' ' + py.toFixed(2);
      if (i < sampleCount) {
        pathData += ' ';
      }
    }
    if (frontPath) {
      frontPath.setAttribute('d', pathData);
    }
    if (rearPath) {
      rearPath.setAttribute('d', pathData);
    }

    samples.forEach(function (sample) {
      var definition = sample.definition;
      var fzElement = $(definition.fzId);
      var muElement = $(definition.muId);
      var row = document.querySelector('[data-tyre-row="' + definition.code + '"]');
      var isLifted = !(sample.load > 0);

      if (fzElement) {
        fzElement.textContent = isLifted ? '离地' : (sample.load / 1000).toFixed(2) + ' kN';
      }
      if (muElement) {
        muElement.textContent = isLifted ? '—' : sample.mu.toFixed(3);
      }
      if (row) {
        row.classList.toggle('is-lifted', isLifted);
      }

      if (isLifted) {
        return;
      }

      var pointX = xPixel(sample.load);
      var pointY = yPixel(sample.mu);
      var marker = createSvgElement('circle', {
        cx: pointX.toFixed(2),
        cy: pointY.toFixed(2),
        r: 4.6,
        class: 'tyre-point-marker tyre-point-marker--' + definition.axle +
          ' is-' + definition.side
      });
      marker.appendChild(createSvgElement('title', null,
        definition.code + ' · Fz ' + (sample.load / 1000).toFixed(2) +
        ' kN · μ ' + sample.mu.toFixed(3)));
      pointsGroup.appendChild(marker);

      pointsGroup.appendChild(createSvgElement('text', {
        x: (pointX + definition.labelDx).toFixed(2),
        y: (pointY + definition.labelDy).toFixed(2),
        'text-anchor': definition.anchor,
        class: 'tyre-point-label tyre-point-label--' + definition.axle
      }, definition.code));
    });

    if (note) {
      if (currentTyreId === 'custom') {
        note.textContent = '自定义模式：前后轴共用同一组 μ_ref / k；四点为当前实际轮荷。';
      } else {
        var compound = TYRE_COMPOUNDS[currentTyreId];
        note.textContent = 'AC ' + (compound ? compound.section : '') +
          '；前后轴参数相同，两条曲线重合。四点为当前实际轮荷。';
      }
    }

    var pointSummary = samples.map(function (sample) {
      if (!(sample.load > 0)) {
        return sample.definition.code + ' 离地';
      }
      return sample.definition.code + ' Fz ' + (sample.load / 1000).toFixed(2) +
        ' kN，μ ' + sample.mu.toFixed(3);
    }).join('；');
    svg.setAttribute('aria-label',
      currentTyreName() + ' 轮胎 μ–Fz 曲线；' + pointSummary + '。');
  }

  function updatePresetActive() {
    var buttons = document.querySelectorAll('[data-preset]');
    buttons.forEach(function (button) {
      var preset = PRESETS[button.getAttribute('data-preset')];
      if (!preset) {
        return;
      }
      var matches = Object.keys(preset).every(function (key) {
        return Math.abs(state[key] - preset[key]) < 0.05;
      });
      button.classList.toggle('is-active', matches);
    });
  }

  function render() {
    var result = model.calculate(state);

    updateConditionAndSetup(result);
    updateGPad(result);
    updateBalance(result);
    updateCards(result);
    updateWheelLabels(result);
    updatePresetActive();
    renderTyreCurve(result);

    if (scene) {
      scene.setModel(result);
    }

    syncControls();
    syncTyreUi();
  }

  function applyStatePatch(patch, options) {
    var opts = options || {};
    Object.keys(patch).forEach(function (key) {
      state[key] = patch[key];
    });
    if (opts.clearAuto !== false) {
      clearAutoNote();
    }
    syncControls();
    render();
  }

  function handleParameterInput(element, isCommit) {
    var key = element.getAttribute('data-param');
    if (!key) {
      return;
    }
    var value = Number(element.value);
    if (!Number.isFinite(value)) {
      return;
    }

    var min = element.min !== '' ? Number(element.min) : model.LIMITS[key][0];
    var max = element.max !== '' ? Number(element.max) : model.LIMITS[key][1];
    if (!isCommit && (value < min || value > max)) {
      return;
    }
    value = clamp(value, min, max);

    state[key] = value;
    clearAutoNote();
    syncControls();
    render();
  }

  function bindControls() {
    bindGPad();

    parameterElements.forEach(function (element) {
      var isRange = element.type === 'range';
      element.addEventListener(isRange ? 'input' : 'input', function () {
        handleParameterInput(element, false);
      });
      if (!isRange) {
        element.addEventListener('change', function () {
          handleParameterInput(element, true);
        });
        element.addEventListener('blur', function () {
          handleParameterInput(element, true);
        });
      }
      if (isRange) {
        updateRangeFill(element);
      }
    });

    var frontWeightInput = $('frontWeightPct');
    if (frontWeightInput) {
      function applyFrontWeight(isCommit) {
        var pct = Number(frontWeightInput.value);
        if (!Number.isFinite(pct)) {
          return;
        }
        if (!isCommit && (pct < 40 || pct > 66)) {
          return;
        }
        pct = clamp(pct, 40, 66);
        state.frontWeight = pct / 100;
        clearAutoNote();
        syncControls();
        render();
      }
      frontWeightInput.addEventListener('input', function () { applyFrontWeight(false); });
      frontWeightInput.addEventListener('change', function () { applyFrontWeight(true); });
      frontWeightInput.addEventListener('blur', function () { applyFrontWeight(true); });
    }

    var tyreSelect = $('tyreCompoundSelect');
    if (tyreSelect) {
      tyreSelect.addEventListener('change', function () {
        currentTyreId = tyreSelect.value;
        var compound = TYRE_COMPOUNDS[currentTyreId];
        if (compound) {
          state.tireMuRef = compound.muRef;
          state.tireFz0N = compound.fz0N;
          state.tireLoadSensitivityK = compound.k;
        }
        clearAutoNote();
        syncTyreUi();
        render();
      });
    }

    document.querySelectorAll('[data-preset]').forEach(function (button) {
      button.addEventListener('click', function () {
        var preset = PRESETS[button.getAttribute('data-preset')];
        if (!preset) {
          return;
        }
        clearAutoNote();
        applyStatePatch(preset);
      });
    });

    var autoButton = $('autoBalanceButton');
    if (autoButton) {
      autoButton.addEventListener('click', function () {
        var solution = model.solveNeutralFrontArb(state);
        state.arbFrontNmm = solution.value;
        syncControls();
        render();

        var note = $('autoBalanceNote');
        if (note) {
          if (solution.achieved) {
            note.textContent = '已调前 ARB → ' + solution.value.toFixed(1) +
              ' N/mm · 残余 ' + formatSigned(solution.deltaPP, 1) + ' pp';
          } else {
            note.textContent = '当前范围无法完全配平；前 ARB 取边界 ' +
              solution.value.toFixed(1) + ' N/mm · 残余 ' + formatSigned(solution.deltaPP, 1) + ' pp';
          }
        }

        if (autoNoteTimer) {
          window.clearTimeout(autoNoteTimer);
        }
        autoNoteTimer = window.setTimeout(function () {
          var noteElement = $('autoBalanceNote');
          if (noteElement) {
            noteElement.textContent = '';
          }
        }, 9000);
      });
    }

    var resetAllButton = $('resetAllButton');
    if (resetAllButton) {
      resetAllButton.addEventListener('click', function () {
        stopGPlayback(false);
        clearGTrail();
        clearAutoNote();
        state = model.cloneBaseState();
        currentTyreId = model.DATA.defaultCompoundId;
        syncControls();
        syncTyreUi();
        render();
      });
    }

    var resetViewButton = $('resetViewButton');
    if (resetViewButton) {
      resetViewButton.addEventListener('click', function () {
        if (scene && typeof scene.resetView === 'function') {
          scene.resetView();
        }
      });
    }
  }

  function showSceneError(code, message) {
    var loading = $('sceneLoading');
    var error = $('sceneError');
    var codeElement = error ? error.querySelector('.scene-error-code') : null;
    if (loading) {
      loading.classList.add('is-hidden');
    }
    if (error) {
      error.hidden = false;
    }
    if (codeElement) {
      codeElement.textContent = code;
    }
    if (message) {
      var paragraph = error ? error.querySelector('p') : null;
      if (paragraph) {
        paragraph.textContent = message;
      }
    }
    var wheelLabels = document.querySelector('.scene-wheel-labels');
    if (wheelLabels) {
      wheelLabels.style.display = 'none';
    }
  }

  function initScene() {
    if (!window.THREE) {
      showSceneError('THREE.JS MISSING', '本地 Three.js 文件未加载，3D 底盘无法启动；数值模拟仍可使用。');
      return;
    }
    if (!window.CorneringChassisScene) {
      showSceneError('3D MODULE MISSING', '3D 场景模块未加载，数值模拟仍可使用。');
      return;
    }

    try {
      scene = new window.CorneringChassisScene($('sceneContainer'), {
        onReady: function () {
          render();
        }
      });
      scene.setModel(model.calculate(state));
    } catch (error) {
      scene = null;
      showSceneError('WEBGL UNAVAILABLE', '请启用浏览器硬件加速或使用支持 WebGL 的浏览器；数值模拟仍可使用。');
    }
  }

  function init() {
    buildGaugeTicks();
    buildGPad();
    syncControls();
    bindControls();
    render();
    initScene();
    render();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.addEventListener('beforeunload', function () {
    if (scene && typeof scene.dispose === 'function') {
      scene.dispose();
    }
  });
})();
